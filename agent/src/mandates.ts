import type {Mandate} from "./types";

/**
 * Three underwriters with genuinely different books.
 *
 * Divergence is not decoration. If three agents produce the same number they
 * are one script holding three keys, and the contest mechanism proves nothing.
 * These mandates disagree about advance rate, about which grades are
 * touchable at all, and about what the standing commitment is worth.
 */
export const MANDATES: Record<string, Mandate> = {
  conservative: {
    name: "CONSERVATIVE",
    appetite: 0.8,
    premiumRate: 1_200_000_000_000_000n,
    refuses: ["C", "D", "REJECT"],
    ceiling: 50_000,
    bias: "Prices the tail it cannot hedge. Would rather miss the load than own it",
  },
  sector: {
    name: "SECTOR",
    appetite: 0.92,
    premiumRate: 1_000_000_000_000_000n,
    refuses: ["D", "REJECT"],
    ceiling: 120_000,
    bias: "Underwrites agricultural lanes weekly. Pays up where its own book says the obligor settles",
  },
  aggressive: {
    name: "AGGRESSIVE",
    appetite: 0.97,
    premiumRate: 800_000_000_000_000n,
    refuses: ["REJECT"],
    ceiling: 250_000,
    bias: "Happy to take delivery. Treats the invoice as an asset it wants, not a risk it tolerates",
  },
};
