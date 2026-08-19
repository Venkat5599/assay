/**
 * WHERE AGENTS MAY ACT ALONE.
 *
 * Autonomy is not a preference here, it is a function of what the settlement
 * asset is worth. On testnet the agents settle in a token this project mints
 * and anyone can replace; letting them watch the book and contest each other
 * unattended costs nothing anyone can lose, and it is the only way to show the
 * mechanism doing what it was designed to do. On mainnet they escrow bridged
 * USDT, and a model grading real money without anybody reading the grade first
 * is not a demo, it is an unreviewed trading system.
 *
 * So the rule is drawn from the chain, not from a habit or a config file
 * someone forgot to flip: testnet acts, mainnet proposes. The override exists
 * because a rule with no escape hatch gets worked around in worse ways, and it
 * is deliberately loud - it must be set to the exact string, and every run that
 * uses it says so.
 */

export const TESTNET_CHAIN_ID = 968;
export const MAINNET_CHAIN_ID = 677;

/** The exact value `ALLOW_AUTONOMOUS_MAINNET` must carry to be honoured. */
export const OVERRIDE_PHRASE = "i-accept-unreviewed-bids";

export interface Autonomy {
  allowed: boolean;
  /** True when only an explicit override unlocked it. */
  overridden: boolean;
  reason: string;
}

export function autonomyFor(chainId: number, env: NodeJS.ProcessEnv = process.env): Autonomy {
  if (chainId === TESTNET_CHAIN_ID) {
    return {
      allowed: true,
      overridden: false,
      reason: "testnet: settlement token is freely mintable, so nothing here is anyone's money",
    };
  }

  if (env.ALLOW_AUTONOMOUS_MAINNET === OVERRIDE_PHRASE) {
    return {
      allowed: true,
      overridden: true,
      reason: `override set: bidding real capital on chain ${chainId} with no human review`,
    };
  }

  return {
    allowed: false,
    overridden: false,
    reason:
      `chain ${chainId} settles in an asset this protocol does not issue. ` +
      "Use `bun run propose` and approve with `bun run execute -- --yes`",
  };
}
