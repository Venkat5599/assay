import {describe, expect, test} from "vitest";
import {parseUnits} from "viem";

import {BLOCK_SECONDS, HAIRCUT, project} from "./decay";
import type {Position} from "./useOps";

/**
 * Floor decay is the property the whole "governance-free risk" claim rests on,
 * and it spent most of this project's life as a struct field that nothing ever
 * assigned - declared, read in two places, permanently zero. The contract now
 * has an invariant that fails if it is ever unwired again; this is the same
 * guard on the side that tells a user when their position becomes callable.
 */

const usdt = (v: string) => parseUnits(v, 6);

/** Matches the deployed default: 2.15e-8 per block, in RAY. */
const RATE = 21_500_000_000_000_000_000n;

const pos = (over: Partial<Position> = {}): Position =>
  ({
    id: 1n,
    floor: usdt("15000"),
    debt: usdt("10000"),
    decayRate: RATE,
    ...over,
  }) as Position;

describe("project", () => {
  test("reports no projection when the slot carries no decay", () => {
    expect(project(pos({decayRate: 0n}))!.rate).toBe(0);
  });

  test("returns nothing for an unpriced slot", () => {
    expect(project(pos({floor: 0n}))).toBeNull();
  });

  test("callable level is the debt grossed up by the haircut", () => {
    // maxBorrow = floor x (1 - haircut). The position turns callable when that
    // falls under the debt, so the floor that matters is debt / (1 - haircut).
    const p = project(pos())!;
    expect(p.callableAt).toBeCloseTo(Number(usdt("10000")) / (1 - HAIRCUT), 6);
    expect(p.callableAt).toBeCloseTo(Number(usdt("12500")), 6);
  });

  test("time to callable matches the compounding the contract performs", () => {
    const p = project(pos())!;
    const rate = Number(RATE) / 1e27;
    const expected =
      Math.log(p.callableAt / Number(usdt("15000"))) / Math.log(1 - rate);
    expect(p.blocks).toBeCloseTo(expected, 0);
    expect(p.days).toBeCloseTo((expected * BLOCK_SECONDS) / 86_400, 3);
  });

  test("the deployed rate erodes roughly a fifth over a 90-day receivable", () => {
    // The number the README quotes. If the default rate is ever retuned, this
    // is where the documentation and the contract part company.
    const rate = Number(RATE) / 1e27;
    const blocks = (90 * 86_400) / BLOCK_SECONDS;
    const remaining = Math.pow(1 - rate, blocks);
    expect(1 - remaining).toBeGreaterThan(0.17);
    expect(1 - remaining).toBeLessThan(0.23);
  });

  test("an undrawn position never becomes callable by decay alone", () => {
    // No debt means no coverage to breach. Decay still lowers the ceiling on
    // what could be drawn, but nothing is callable.
    const p = project(pos({debt: 0n}))!;
    expect(p.blocks).toBeNull();
    expect(p.days).toBeNull();
  });

  test("a position already past the threshold reports no waiting time", () => {
    // Floor beneath debt / (1 - haircut) already: callable now, not in N days.
    const p = project(pos({floor: usdt("11000"), debt: usdt("10000")}))!;
    expect(p.blocks).toBeNull();
  });

  test("the curve never falls below the outstanding debt", () => {
    // `_tick` clamps decay at the debt so the lender is always made whole. A
    // chart that ran past it would be drawing a state the contract cannot reach.
    const p = project(pos())!;
    for (const point of p.curve) {
      expect(point.floor).toBeGreaterThanOrEqual(Number(usdt("10000")));
    }
  });

  test("the curve is monotonically non-increasing", () => {
    const p = project(pos())!;
    for (let i = 1; i < p.curve.length; i++) {
      expect(p.curve[i]!.floor).toBeLessThanOrEqual(p.curve[i - 1]!.floor);
    }
  });

  test("the curve starts at today's floor", () => {
    const p = project(pos())!;
    expect(p.curve[0]!.floor).toBeCloseTo(Number(usdt("15000")), 0);
    expect(p.curve[0]!.day).toBe(0);
  });

  test("the horizon always contains the crossing it is drawn to show", () => {
    for (const debt of ["1000", "5000", "10000", "11900"]) {
      const p = project(pos({debt: usdt(debt)}))!;
      if (p.days === null) continue;
      expect(p.horizonDays).toBeGreaterThan(p.days);
    }
  });

  test("a faster rate always brings the call date forward", () => {
    const slow = project(pos({decayRate: RATE}))!;
    const fast = project(pos({decayRate: RATE * 4n}))!;
    expect(fast.days!).toBeLessThan(slow.days!);
  });
});
