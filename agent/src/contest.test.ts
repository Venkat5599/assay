import {describe, expect, test} from "bun:test";
import {parseUnits} from "viem";

import {contest} from "./contest";
import type {Quote} from "./types";

/**
 * The contest rule mirrors `FirmBidMarket.bid`, and a mismatch between the two
 * is expensive in a specific way: the agent does not misbehave, it reverts, and
 * a revert in a log reads like a considered decision not to bid. Every case
 * here is a shape the contract accepts or rejects, asserted from this side.
 */

const usdt = (v: string) => parseUnits(v, 6);
const MIN = 25n; // minImprovementBps, 0.25%

const slot = (floor: string, rate: bigint) => ({
  underwriter: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  floor: usdt(floor),
  premiumRate: rate,
  premiumReserve: usdt("400"),
});

const quote = (floor: string, rate: bigint): Quote => ({
  floor: usdt(floor),
  premiumRate: rate,
  abstain: false,
});

describe("contest", () => {
  test("outbids on floor when clear of the improvement margin", () => {
    const move = contest(quote("20000", 1_000_000_000_000_000n), slot("15000", 1_000_000_000_000_000n), MIN);
    expect(move).not.toBeNull();
    expect(move!.floor).toBe(usdt("20000"));
  });

  test("refuses a floor inside the anti-griefing margin", () => {
    // 0.1% better, under the 0.25% the contract demands.
    expect(contest(quote("15015", 1_000_000_000_000_000n), slot("15000", 1_000_000_000_000_000n), MIN)).toBeNull();
  });

  test("clamps its own rate to the incumbent's when raising the floor", () => {
    // The contract rejects a bid that raises the floor AND the rate. An agent
    // with a dearer mandate must accept the standing rate or not bid at all.
    const move = contest(quote("20000", 9_000_000_000_000_000n), slot("15000", 1_000_000_000_000_000n), MIN);
    expect(move).not.toBeNull();
    expect(move!.rate).toBe(1_000_000_000_000_000n);
    expect(move!.rate <= slot("15000", 1_000_000_000_000_000n).premiumRate).toBe(true);
  });

  test("wins on rate alone by matching the floor and charging less", () => {
    const move = contest(quote("15000", 800_000_000_000_000n), slot("15000", 1_000_000_000_000_000n), MIN);
    expect(move).not.toBeNull();
    expect(move!.floor).toBe(usdt("15000"));
    expect(move!.rate).toBe(800_000_000_000_000n);
  });

  test("will not undercut on rate for an asset its book would not pay for", () => {
    // Cheaper premium, but the mandate only values the asset at 12,000. Holding
    // a 15,000 commitment it does not believe in is how an underwriter dies.
    expect(contest(quote("12000", 100_000_000_000_000n), slot("15000", 1_000_000_000_000_000n), MIN)).toBeNull();
  });

  test("refuses a rate inside the improvement margin", () => {
    // 0.1% cheaper, under the 0.25% threshold.
    expect(contest(quote("15000", 999_000_000_000_000n), slot("15000", 1_000_000_000_000_000n), MIN)).toBeNull();
  });

  test("never returns a move that worsens either axis", () => {
    const incumbent = slot("15000", 1_000_000_000_000_000n);
    const candidates: Quote[] = [
      quote("20000", 9_000_000_000_000_000n),
      quote("15000", 500_000_000_000_000n),
      quote("15040", 1_000_000_000_000_000n),
      quote("100000", 0n),
    ];
    for (const q of candidates) {
      const move = contest(q, incumbent, MIN);
      if (!move) continue;
      expect(move.floor >= incumbent.floor).toBe(true);
      expect(move.rate <= incumbent.premiumRate).toBe(true);
    }
  });

  test("a zero incumbent rate cannot be undercut", () => {
    // Nothing is cheaper than free, so the only way past is the floor.
    expect(contest(quote("15000", 0n), slot("15000", 0n), MIN)).toBeNull();
    expect(contest(quote("20000", 0n), slot("15000", 0n), MIN)).not.toBeNull();
  });
});
