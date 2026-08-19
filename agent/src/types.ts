export type Grade = "A" | "B" | "C" | "D" | "REJECT";

export interface Load {
  assetId: bigint;
  debtor: `0x${string}`;
  faceValue: bigint;
  dueDate: bigint;
  docHash: `0x${string}`;
}

/** What the judgment layer returns. Never a price - only a grade and a reason. */
export interface Assessment {
  grade: Grade;
  rationale: string;
  source: "model" | "rubric";
}

export interface Mandate {
  name: string;
  /** Multiplier on the graded advance rate. Appetite, expressed as a number. */
  appetite: number;
  /** Per-block premium demanded, RAY. */
  premiumRate: bigint;
  /** Grades this agent refuses outright. */
  refuses: Grade[];
  /** Largest face value this book will look at, in whole tokens. */
  ceiling: number;
  bias: string;
}

/** What the pricing kernel emits. Re-exported here so callers of `price` can
 *  name the type without importing from the module that produces it. */
export interface Quote {
  floor: bigint;
  premiumRate: bigint;
  abstain: boolean;
}

/**
 * A graded, priced bid awaiting human approval.
 *
 * Written by `propose`, read by `execute`. Everything needed to replay the
 * decision later is captured here - which model produced the grade, what it
 * was looking at, and what the pricing kernel derived from it - so a number
 * that moved capital can always be traced back to the judgement behind it.
 */
export interface Proposal {
  agent: string;
  book: string;
  underwriter: string;
  assetId: string;
  faceValue: string;
  docHash: string;
  grade: Grade;
  rationale: string;
  source: Assessment["source"];
  model: string;
  floor: string;
  premiumRate: string;
  reason: string;
  /** Slot state when the proposal was formed, so staleness is detectable. */
  observedFloor: string;
  observedUnderwriter: string;
  proposedAt: string;
}
