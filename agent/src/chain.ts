import {createPublicClient, createWalletClient, defineChain, http, type Address} from "viem";
import {privateKeyToAccount} from "viem/accounts";

const RPC = process.env.RPC_URL ?? "https://rpc.bohr.life";
const CHAIN_ID = Number(process.env.CHAIN_ID ?? 968);

export const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 968 ? "BOT Chain Testnet" : "BOT Chain",
  nativeCurrency: {name: "BOT", symbol: "BOT", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

export const publicClient = createPublicClient({chain, transport: http()});

export function walletFor(privateKey: `0x${string}`) {
  const account = privateKeyToAccount(privateKey);
  return {account, client: createWalletClient({account, chain, transport: http()})};
}

/**
 * Precision of the settlement asset. Bridged USDT on BOT Chain is SIX decimals,
 * not eighteen. Assuming eighteen makes every figure an agent reasons about a
 * million times too small, which quietly changes its grade rather than throwing.
 */
export const DECIMALS = Number(process.env.STABLE_DECIMALS ?? 6);

export const CONTRACTS = {
  registry: process.env.ASSET_REGISTRY as Address,
  market: process.env.FIRM_BID_MARKET as Address,
  vault: process.env.LOAN_VAULT as Address,
  stable: process.env.STABLE_TOKEN as Address,
};

export const marketAbi = [
  {
    type: "function",
    name: "bid",
    stateMutability: "nonpayable",
    inputs: [
      {name: "assetId", type: "uint256"},
      {name: "newFloor", type: "uint256"},
      {name: "newRate", type: "uint128"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "currentFloor",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "slots",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "owner", type: "address"},
          {name: "underwriter", type: "address"},
          {name: "lastTick", type: "uint64"},
          {name: "open", type: "bool"},
          {name: "floor", type: "uint256"},
          {name: "escrow", type: "uint256"},
          {name: "accrued", type: "uint256"},
          {name: "premiumReserve", type: "uint256"},
          {name: "premiumRate", type: "uint128"},
          {name: "decayRate", type: "uint128"},
        ],
      },
    ],
  },
  {
    type: "function",
    name: "withdrawBid",
    stateMutability: "nonpayable",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [],
  },
  {
    type: "function",
    name: "minImprovementBps",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
] as const;

export const vaultAbi = [
  {
    type: "function",
    name: "outstanding",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
] as const;

export const registryAbi = [
  {
    type: "event",
    name: "Registered",
    inputs: [
      {name: "id", type: "uint256", indexed: true},
      {name: "owner", type: "address", indexed: true},
      {name: "docHash", type: "bytes32", indexed: true},
      {name: "faceValue", type: "uint128", indexed: false},
    ],
  },
  {
    type: "function",
    name: "receivableOf",
    stateMutability: "view",
    inputs: [{name: "id", type: "uint256"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "debtor", type: "address"},
          {name: "faceValue", type: "uint128"},
          {name: "dueDate", type: "uint64"},
          {name: "registeredAt", type: "uint64"},
          {name: "docHash", type: "bytes32"},
        ],
      },
    ],
  },
  {
    type: "function",
    name: "exists",
    stateMutability: "view",
    inputs: [{name: "id", type: "uint256"}],
    outputs: [{type: "bool"}],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      {name: "spender", type: "address"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      {name: "to", type: "address"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      {name: "to", type: "address"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      {name: "owner", type: "address"},
      {name: "spender", type: "address"},
    ],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}],
  },
] as const;
