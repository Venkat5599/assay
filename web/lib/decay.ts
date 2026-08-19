import type {Position} from "./useOps";

/**
 * Floor decay, projected.
 *
 * Split out of the component so the arithmetic can be tested without a browser.
 * This is the mechanism that makes risk parameters governance-free, and it
 * spent most of this project's life as a struct field nothing assigned - so the
 * one thing that must never happen again is the maths going wrong quietly.
 *
 * Mirrors `FirmBidMarket._tick`, including its clamp at the outstanding debt.
 */

const RAY = 1e27;

/** BOT Chain, measured over 1000 blocks at the head. */
export const BLOCK_SECONDS = 0.75;

/** Mirrors FirmBidMarket.haircutBps. */
export const HAIRCUT = 0.2;

export interface Projection {
  /** Fractional decay per block. */
  rate: number;
  /** Floor beneath which maxBorrow no longer covers the debt. */
  callableAt: number;
  /** Blocks until that happens, or null when it never does. */
  blocks: number | null;
  days: number | null;
  /** Sampled floor curve, oldest first. */
  curve: {day: number; floor: number}[];
  horizonDays: number;
  floorNow: number;
  debt: number;
}

export function project(p: Position): Projection | null {
  const rate = Number(p.decayRate) / RAY;
  const floorNow = Number(p.floor);
  const debt = Number(p.debt);
  if (floorNow <= 0) return null;

  // Callable when maxBorrow = floor x (1 - haircut) falls under the debt.
  const callableAt = debt / (1 - HAIRCUT);

  let blocks: number | null = null;
  if (rate > 0 && debt > 0 && callableAt < floorNow) {
    // floor x (1 - r)^n = target  ->  n = ln(target / floor) / ln(1 - r)
    blocks = Math.log(callableAt / floorNow) / Math.log(1 - rate);
  }
  const days = blocks === null ? null : (blocks * BLOCK_SECONDS) / 86_400;

  // Show the crossing with room around it, or a default window when there is
  // no crossing to show.
  const horizonDays = Math.max(7, Math.ceil((days ?? 90) * 1.35));
  const steps = 48;
  const curve = Array.from({length: steps + 1}, (_, i) => {
    const day = (horizonDays * i) / steps;
    const n = (day * 86_400) / BLOCK_SECONDS;
    // `_tick` clamps decay at the outstanding debt, so the lender is always
    // made whole. The curve flattens there rather than continuing down.
    return {day, floor: Math.max(floorNow * Math.pow(1 - rate, n), debt)};
  });

  return {rate, callableAt, blocks, days, curve, horizonDays, floorNow, debt};
}

