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
