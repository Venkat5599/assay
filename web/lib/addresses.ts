import type {Address} from "viem";

const env = (v: string | undefined): Address | undefined =>
  v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined;

export const addresses = {
  assetRegistry: env(process.env.NEXT_PUBLIC_ASSET_REGISTRY),
  market: env(process.env.NEXT_PUBLIC_FIRM_BID_MARKET),
  vault: env(process.env.NEXT_PUBLIC_LOAN_VAULT),
  stable: env(process.env.NEXT_PUBLIC_STABLE_TOKEN),
};

/**
 * The UI renders fully before contracts exist. Deployment turns the controls
 * live; it never decides whether content is visible.
 */
export const isDeployed = Boolean(
  addresses.assetRegistry && addresses.market && addresses.vault && addresses.stable,
);
