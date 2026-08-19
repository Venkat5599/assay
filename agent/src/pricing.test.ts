import {describe, expect, test} from "bun:test";
import {parseUnits} from "viem";

import {MANDATES} from "./mandates";
import {price} from "./pricing";
import {assessWithRubric} from "./underwrite";
import type {Assessment, Grade, Load} from "./types";

/**
 * The pricing kernel is the only thing in this system allowed to produce a
 * number that moves capital, and the whole defence of letting a model near an
 * underwriting desk rests on this half being deterministic, replayable and
 * testable. It was described that way in three documents and had no tests.
 *
 * Settlement is bridged USDT at six decimals. Every figure here goes through
 * `parseUnits` rather than a literal, because the bug this file is most likely
 * to catch is a decimals assumption drifting back in.
 */

const DECIMALS = 6;
const usdt = (v: string) => parseUnits(v, DECIMALS);

const load = (face: string): Load => ({
  assetId: 1n,
  debtor: "0x000000000000000000000000000000000000dEaD",
  faceValue: usdt(face),
  dueDate: BigInt(Math.floor(Date.now() / 1000) + 60 * 86_400),
  docHash: "0xfeed",
});

const graded = (grade: Grade): Assessment => ({grade, rationale: "test", source: "rubric"});

describe("pricing kernel", () => {
  test("is deterministic - the same inputs always give the same number", () => {
    const l = load("40000");
    const a = graded("B");
    const first = price(l, MANDATES.conservative!, a);
    for (let i = 0; i < 50; i++) {
      expect(price(l, MANDATES.conservative!, a)).toEqual(first);
    }
  });

  test("never advances more than face value", () => {
    const l = load("40000");
    for (const mandate of Object.values(MANDATES)) {
      for (const g of ["A", "B", "C", "D"] as Grade[]) {
        const q = price(l, mandate, graded(g));
        expect(q.floor <= l.faceValue).toBe(true);
      }
    }
  });

  test("a worse grade never prices higher", () => {
    const l = load("40000");
    const order: Grade[] = ["A", "B", "C", "D"];
    for (const mandate of Object.values(MANDATES)) {
      const quotes = order
        .filter((g) => !mandate.refuses.includes(g))
        .map((g) => price(l, mandate, graded(g)).floor);
      for (let i = 1; i < quotes.length; i++) {
        expect(quotes[i]! <= quotes[i - 1]!).toBe(true);
      }
    }
  });

  test("REJECT never produces a bid, from any mandate", () => {
    for (const mandate of Object.values(MANDATES)) {
      const q = price(load("40000"), mandate, graded("REJECT"));
      expect(q.abstain).toBe(true);
      expect(q.floor).toBe(0n);
    }
  });

  test("a mandate abstains on every grade it refuses", () => {
    for (const mandate of Object.values(MANDATES)) {
      for (const g of mandate.refuses) {
        expect(price(load("40000"), mandate, graded(g)).abstain).toBe(true);
      }
    }
  });

  test("emits integers - no float ever reaches the chain", () => {
    for (const face of ["1", "7", "18400", "12345.67", "250000"]) {
      for (const mandate of Object.values(MANDATES)) {
        const q = price(load(face), mandate, graded("B"));
        expect(typeof q.floor).toBe("bigint");
        expect(typeof q.premiumRate).toBe("bigint");
      }
    }
  });

  test("scales linearly with face value, so decimals cannot drift", () => {
    const small = price(load("1000"), MANDATES.aggressive!, graded("A")).floor;
    const large = price(load("10000"), MANDATES.aggressive!, graded("A")).floor;
    expect(large).toBe(small * 10n);
  });

  test("the three books genuinely disagree", () => {
    // If three agents produce one number they are one script holding three
    // keys, and the contest mechanism proves nothing. This is the assertion
    // that keeps that honest.
    const l = load("40000");
    const floors = Object.values(MANDATES).map((m) => price(l, m, graded("B")).floor);
    expect(new Set(floors.map(String)).size).toBe(floors.length);

    const rates = Object.values(MANDATES).map((m) => m.premiumRate);
    expect(new Set(rates.map(String)).size).toBe(rates.length);
  });
});

describe("rubric fallback", () => {
  test("grades, and marks its own provenance", () => {
    const a = assessWithRubric(load("40000"), MANDATES.sector!);
    expect(["A", "B", "C", "D", "REJECT"]).toContain(a.grade);
    expect(a.source).toBe("rubric");
    expect(a.rationale.length).toBeGreaterThan(0);
  });

  test("is deterministic for a fixed load", () => {
    const l = load("40000");
    const first = assessWithRubric(l, MANDATES.sector!).grade;
    for (let i = 0; i < 20; i++) {
      expect(assessWithRubric(l, MANDATES.sector!).grade).toBe(first);
    }
  });

  test("marks a load past the book's ceiling down hard", () => {
    const inside = assessWithRubric(load("10000"), MANDATES.conservative!);
    const outside = assessWithRubric(load("500000"), MANDATES.conservative!);
    const rank: Record<Grade, number> = {A: 4, B: 3, C: 2, D: 1, REJECT: 0};
    expect(rank[outside.grade]).toBeLessThan(rank[inside.grade]);
  });

  test("reads face value at six decimals, not eighteen", () => {
    // An 18-decimal reading of a 40,000 USDT load is 0.00000000004, which every
    // mandate would wave through as a comfortably small ticket. The ceiling
    // test above is the tripwire; this pins the cause.
    const a = assessWithRubric(load("500000"), MANDATES.conservative!);
    expect(a.rationale).toContain("ceiling");
  });
});
