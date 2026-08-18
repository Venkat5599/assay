import {formatUnits} from "viem";

const nf = new Intl.NumberFormat("en-US", {maximumFractionDigits: 0});
const nf2 = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});

export function usd(value: bigint | undefined, decimals = 18): string {
  if (value === undefined) return "--";
  const n = Number(formatUnits(value, decimals));
  return n >= 1000 ? nf.format(n) : nf2.format(n);
}

export function shortAddress(a?: string): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "--";
}

/**
 * Human reference for a receivable.
 *
 * The chain stores a document hash, not a bill-of-lading number, so this is a
 * deterministic rendering of that hash rather than a stored field: the same
 * document always yields the same reference, and the full hash stays one click
 * away. It is a label for real data, never a stand-in for missing data.
 */
export function bolRef(docHash?: string): string {
  if (!docHash) return "--";
  const n = parseInt(docHash.slice(2, 10), 16) % 100000;
  return `BOL-${String(n).padStart(5, "0")}`;
}
