import type {Assessment, Load, Mandate, Quote} from "./types";

/**
 * THE PRICING KERNEL.
 *
 * Pure, deterministic, and the only thing permitted to produce a number. Given
 * a grade and a mandate it always returns the same floor, which is what makes
 * an agent's bid replayable and testable long after it was placed.
 */

/** Base advance rate against face value, by grade. */
const ADVANCE: Record<Assessment["grade"], number> = {
  A: 0.92,
  B: 0.85,
  C: 0.72,
  D: 0.55,
  REJECT: 0,
};

export type {Quote};

export function price(load: Load, mandate: Mandate, assessment: Assessment): Quote {
  if (mandate.refuses.includes(assessment.grade)) {
    return {floor: 0n, premiumRate: 0n, abstain: true};
  }

  const rate = ADVANCE[assessment.grade] * mandate.appetite;
  if (rate <= 0) return {floor: 0n, premiumRate: 0n, abstain: true};

  // Basis points keep the arithmetic integral; no float ever reaches the chain.
  const bps = BigInt(Math.round(rate * 10_000));
  return {
    floor: (load.faceValue * bps) / 10_000n,
    premiumRate: mandate.premiumRate,
    abstain: false,
  };
}
