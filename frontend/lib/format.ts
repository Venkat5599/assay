import {formatUnits, parseUnits} from "viem";

import {ACTIVE} from "./networks";

/**
 * Precision of the settlement asset.
 *
 * LADING settles in bridged USDT on BOT Chain, which carries SIX decimals, not
 * the eighteen almost every EVM token uses. Assuming eighteen renders every
 * figure in the product a million times too large, and it is a silent failure -
 * the numbers still format, they are just wrong.
 *
 * So it lives here once, and nothing downstream is allowed to guess. It comes
 * from the active deployment rather than a global, because the settlement asset
 * is a constructor argument: testnet settles in an 18-decimal token this
 * project mints, mainnet in 6-decimal bridged USDT. Switching network without
 * switching precision would be the same silent failure in the other direction.
 */
export const DECIMALS = ACTIVE.decimals;

/** Ticker of the settlement asset on the active deployment. */
export const SYMBOL = ACTIVE.symbol;

/** Human string -> token units, at the settlement asset's precision. */
export const toUnits = (v: string): bigint => parseUnits(v || "0", DECIMALS);

/** Token units -> human string. Never do this with Number division. */
export const fromUnits = (v: bigint | undefined): string =>
  v === undefined ? "" : formatUnits(v, DECIMALS);

const nf = new Intl.NumberFormat("en-US", {maximumFractionDigits: 0});
const nf2 = new Intl.NumberFormat("en-US", {maximumFractionDigits: 2});

export function usd(value: bigint | undefined, decimals = DECIMALS): string {
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
