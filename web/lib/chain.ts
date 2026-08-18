import {defineChain} from "viem";

/**
 * BOT Chain mainnet. Declared locally because it is not in viem/chains yet.
 */
export const botChain = defineChain({
  id: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 677),
  name: "BOT Chain",
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {
    default: {http: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.botchain.ai"]},
  },
  blockExplorers: {
    default: {name: "BOT Scan", url: "https://scan.botchain.ai"},
  },
});

export const explorerTx = (hash: string) => `https://scan.botchain.ai/tx/${hash}`;
export const explorerAddress = (addr: string) => `https://scan.botchain.ai/address/${addr}`;
