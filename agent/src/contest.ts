import type {Address} from "viem";

import type {Quote} from "./types";

/**
 * The contest rule, mirroring `FirmBidMarket.bid`.
 *
 * Kept in its own module so it can be tested without a chain. A mismatch
 * between this and the contract is expensive in a particular way: the agent
 * does not misbehave, it reverts, and a revert in a log reads like a considered
 * decision not to bid rather than a bug.
 */

export type Slot = {
  underwriter: Address;
  floor: bigint;
  premiumRate: bigint;
  premiumReserve: bigint;
};

/**
 * Decide how to contest a standing bid, or that we should not.
 *
 * The contract will accept a bid only if it is no worse on either axis and
 * strictly better by the minimum margin on at least one. There are therefore
 * two distinct ways to win a slot, and the agent used to know about one:
 *
 *   FLOOR  - offer more money. The rate must still not exceed the incumbent's,
 *            so it is clamped rather than left at the mandate's own number; an
 *            agent that raised the floor and its own rate together was simply
 *            reverting.
 *   RATE   - match the standing floor and charge less to hold it. Only honest
 *            when the mandate would have paid at least that floor anyway, which
 *            is why it is gated on the agent's own quote rather than on the
 *            incumbent's number.
 *
 * Competing on rate is the half that keeps a slot honest once the floor has
 * stopped moving: with nobody willing to pay more, the remaining competition is
 * over how cheaply the commitment can be held.
 */
export function contest(
  quote: Quote,
  slot: Slot,
  minImprovementBps: bigint,
): {floor: bigint; rate: bigint; why: string} | null {
  const curFloor = slot.floor;
  const curRate = slot.premiumRate;

  const floorNeeded = curFloor + (curFloor * minImprovementBps) / 10_000n;
  if (quote.floor >= floorNeeded && quote.floor > curFloor) {
    // Raising the floor is only accepted alongside a rate no worse than the
    // incumbent's, so take theirs when ours is dearer.
    const rate = quote.premiumRate > curRate ? curRate : quote.premiumRate;
    return {floor: quote.floor, rate, why: "outbids the standing floor"};
  }

  const rateNeeded = curRate - (curRate * minImprovementBps) / 10_000n;
  if (curRate > 0n && quote.premiumRate <= rateNeeded && quote.premiumRate < curRate) {
    // Match the floor and undercut the premium. Refuse if our own book would
    // not have paid this much for the asset.
    if (quote.floor >= curFloor) {
      return {floor: curFloor, rate: quote.premiumRate, why: "holds the same floor for less"};
    }
  }

  return null;
}

