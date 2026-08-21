import type {Address} from "viem";

/**
 * The deployments this frontend can point at.
 *
 * Network was a build-time constant assembled from environment variables, which
 * meant seeing the testnet deployment required a different build. That is fine
 * for a service and wrong for something anyone is meant to click through: the
 * testnet is where you can exercise the loop without buying anything, and it
 * was unreachable from the live site.
 *
 * Everything that differs between deployments lives in one row here. The one
 * that bites hardest is `decimals` - testnet settles in a token this project
 * mints at eighteen decimals, mainnet in bridged USDT at six. A toggle that
 * moved addresses but not precision would render every figure on the testnet
 * a million times too small, silently.
 */

export interface Deployment {
  id: number;
  key: "mainnet" | "testnet";
  name: string;
  short: string;
  rpc: string;
  explorer: string;
  /** Precision of the settlement asset. NOT a property of the chain. */
  decimals: number;
  /** Symbol shown beside balances. */
  symbol: string;
  /** True when the settlement token is openly mintable, so a faucet is honest. */
  mintable: boolean;
  addresses: {
    assetRegistry?: Address;
    market?: Address;
    vault?: Address;
    stable?: Address;
    counterparty?: Address;
  };
}

export const DEPLOYMENTS: Record<Deployment["key"], Deployment> = {
  mainnet: {
    id: 677,
    key: "mainnet",
    name: "BOT Chain",
    short: "MAINNET",
    rpc: "https://rpc.botchain.ai",
    explorer: "https://scan.botchain.ai",
    // Bridged USDT. Six decimals, and LADING does not issue it.
    decimals: 6,
    symbol: "USDT",
    mintable: false,
    addresses: {
      assetRegistry: "0xe33eE752dbb1724f6939A105cecFF2714F684172",
      market: "0x83f8C719854a561b38E85484568E59CD34d81525",
      vault: "0xCc18DFC9a339d9D1298dbD90617121Ce319D358E",
      stable: "0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C",
      counterparty: "0xE07f9907fbA27659e1ED8993A2eA8FE343a91f2F",
    },
  },
  testnet: {
    id: 968,
    key: "testnet",
    name: "BOT Chain Testnet",
    short: "TESTNET",
    rpc: "https://rpc.bohr.life",
    explorer: "https://scan.bohr.life",
    // TestStable, which this project deploys and anyone may mint.
    decimals: 18,
    symbol: "tUSD",
    mintable: true,
    addresses: {
      assetRegistry: "0xC8D510C1363C3db4965f53bcE16344dBebDAceBA",
      market: "0x568633C93b80C08BaB755ecab1C8A3216580Fb6A",
      vault: "0x313b5f7E0ce7293fdf9f5d4a5DBF59b07432E37E",
      stable: "0x8E601297758B1Fb93C2c30E33F11eA36cd553b2E",
      counterparty: "0x13d0B6594BBE65C7d496c4Fd1A862b1d112D2dC2",
    },
  },
};

const STORAGE_KEY = "lading:network";

/** Build-time default, so a fresh visitor lands where the deployment says. */
const DEFAULT: Deployment["key"] =
  Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 677) === 968 ? "testnet" : "mainnet";

/**
 * The deployment in force for this page load.
 *
 * Read once, synchronously, at module scope - every consumer imports the
 * resolved addresses rather than a hook, and a value that changed underneath
 * them mid-session would leave half the screen reading one chain and half the
 * other. Switching therefore reloads, which is the honest cost of changing
 * which chain you are looking at.
 */
export function activeKey(): Deployment["key"] {
  if (typeof window === "undefined") return DEFAULT;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "testnet" || stored === "mainnet" ? stored : DEFAULT;
}

export const ACTIVE: Deployment = DEPLOYMENTS[activeKey()];

/** Switch networks and reload. See the note on ACTIVE for why it reloads. */
export function switchNetwork(key: Deployment["key"]) {
  window.localStorage.setItem(STORAGE_KEY, key);
  window.location.reload();
}
