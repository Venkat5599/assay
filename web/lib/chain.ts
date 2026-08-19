import {defineChain} from "viem";

import {ACTIVE} from "./networks";

export const EXPLORER = ACTIVE.explorer;
export const IS_TESTNET = ACTIVE.key === "testnet";

/** BOT Chain. Declared locally because it is not in viem/chains yet. */
export const botChain = defineChain({
  id: ACTIVE.id,
  name: ACTIVE.name,
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {default: {http: [ACTIVE.rpc]}},
  blockExplorers: {default: {name: "Explorer", url: ACTIVE.explorer}},
});

export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER}/address/${addr}`;
