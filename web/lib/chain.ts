import {defineChain} from "viem";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 677);
const RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.botchain.ai";

/** Explorer differs per network: scan.bohr.life (968) vs scan.botchain.ai (677). */
export const EXPLORER =
  process.env.NEXT_PUBLIC_EXPLORER ??
  (CHAIN_ID === 968 ? "https://scan.bohr.life" : "https://scan.botchain.ai");

export const IS_TESTNET = CHAIN_ID === 968;

/** BOT Chain. Declared locally because it is not in viem/chains yet. */
export const botChain = defineChain({
  id: CHAIN_ID,
  name: IS_TESTNET ? "BOT Chain Testnet" : "BOT Chain",
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
  blockExplorers: {default: {name: "BOTScan", url: EXPLORER}},
});

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;
