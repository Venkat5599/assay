import {describe, expect, test} from "bun:test";
import {parseUnits} from "viem";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {
  MAINNET_CHAIN_ID,
  OVERRIDE_PHRASE,
  TESTNET_CHAIN_ID,
  autonomyFor,
} from "./policy";
import {MANDATES} from "./mandates";
import type {Load} from "./types";

/**
 * This is the boundary between a demo and an unreviewed trading system, so it
 * is tested as a boundary: what matters is not that the flag works but that no
 * plausible mistake opens it. A default, a typo, a truthy string, an empty
 * value, an unknown chain - each of those must fail closed.
 */

const env = (v?: string) => ({ALLOW_AUTONOMOUS_MAINNET: v}) as unknown as NodeJS.ProcessEnv;

describe("autonomy policy", () => {
  test("testnet acts alone", () => {
    const a = autonomyFor(TESTNET_CHAIN_ID, env());
    expect(a.allowed).toBe(true);
    expect(a.overridden).toBe(false);
  });

  test("mainnet does not, by default", () => {
    const a = autonomyFor(MAINNET_CHAIN_ID, env());
    expect(a.allowed).toBe(false);
    expect(a.reason).toContain("propose");
  });

  test("an unknown chain fails closed", () => {
    // A chain nobody wrote a rule for is not a chain to trade on unattended.
    expect(autonomyFor(1, env()).allowed).toBe(false);
    expect(autonomyFor(0, env()).allowed).toBe(false);
  });

  test("only the exact override phrase unlocks mainnet", () => {
    expect(autonomyFor(MAINNET_CHAIN_ID, env(OVERRIDE_PHRASE)).allowed).toBe(true);
  });

  test("truthy-looking values do not unlock mainnet", () => {
    // The usual way a guard like this gets defeated is someone setting it to
    // "true" or "1" because that is what flags normally take.
    for (const v of ["true", "1", "yes", "TRUE", "on", " ", "", "i-accept", OVERRIDE_PHRASE + "x"]) {
      expect(autonomyFor(MAINNET_CHAIN_ID, env(v)).allowed, `value ${JSON.stringify(v)}`).toBe(
        false,
      );
    }
  });

  test("an unlocked mainnet says so loudly", () => {
    const a = autonomyFor(MAINNET_CHAIN_ID, env(OVERRIDE_PHRASE));
    expect(a.overridden).toBe(true);
    expect(a.reason).toContain("no human review");
  });

  test("the override cannot make testnet look overridden", () => {
    // Testnet is already allowed; the flag must not change how that reads.
    expect(autonomyFor(TESTNET_CHAIN_ID, env(OVERRIDE_PHRASE)).overridden).toBe(false);
  });
});

describe("assessment cache", () => {
  const load = (over: Partial<Load> = {}): Load => ({
    assetId: 1n,
    debtor: "0x000000000000000000000000000000000000dEaD",
    faceValue: parseUnits("18400", 6),
    dueDate: 1900000000n,
    docHash: "0xfeedface",
    ...over,
  });

  // Isolated file per run so the suite never reads a real cache.
  process.env.ASSESSMENT_CACHE = join(mkdtempSync(join(tmpdir(), "lading-")), "a.json");
  const cache = require("./cache") as typeof import("./cache");

  test("identical inputs give an identical key", () => {
    const a = cache.keyFor(load(), MANDATES.conservative!, "m");
    const b = cache.keyFor(load(), MANDATES.conservative!, "m");
    expect(a).toBe(b);
  });

  test("every credit input changes the key", () => {
    const base = cache.keyFor(load(), MANDATES.conservative!, "m");
    expect(cache.keyFor(load({faceValue: parseUnits("18401", 6)}), MANDATES.conservative!, "m")).not.toBe(base);
    expect(cache.keyFor(load({dueDate: 1900000001n}), MANDATES.conservative!, "m")).not.toBe(base);
    expect(cache.keyFor(load({docHash: "0xdeadbeef"}), MANDATES.conservative!, "m")).not.toBe(base);
    expect(cache.keyFor(load({debtor: "0x1111111111111111111111111111111111111111"}), MANDATES.conservative!, "m")).not.toBe(base);
  });

  test("a different book grades separately", () => {
    const c = cache.keyFor(load(), MANDATES.conservative!, "m");
    const a = cache.keyFor(load(), MANDATES.aggressive!, "m");
    expect(c).not.toBe(a);
  });

  test("a different model invalidates the grade", () => {
    // A grade is an opinion from a specific model. Reusing it across models
    // would attribute one model's judgement to another.
    expect(cache.keyFor(load(), MANDATES.conservative!, "gpt-4o-mini")).not.toBe(
      cache.keyFor(load(), MANDATES.conservative!, "gpt-4o"),
    );
  });

  test("the asset id alone does not change the key", () => {
    // Two registrations of identical terms are the same credit question. The
    // registry already rejects a duplicate document hash, so this cannot
    // collide across genuinely different paperwork.
    expect(cache.keyFor(load({assetId: 1n}), MANDATES.sector!, "m")).toBe(
      cache.keyFor(load({assetId: 99n}), MANDATES.sector!, "m"),
    );
  });

  test("round-trips a stored assessment", () => {
    const k = cache.keyFor(load(), MANDATES.sector!, "m");
    expect(cache.get(k)).toBeNull();
    cache.put(k, {grade: "B", rationale: "test", source: "rubric"}, {
      book: "SECTOR",
      assetId: 1n,
      model: "m",
    });
    expect(cache.get(k)?.grade).toBe("B");
  });
});
