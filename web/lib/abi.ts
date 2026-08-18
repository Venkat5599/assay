/** Minimal ABI surface - only what the carrier flow touches. */

export const marketAbi = [
  {
    type: "function",
    name: "currentFloor",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "maxBorrow",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "slotOwner",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "address"}],
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
    name: "openSlot",
    stateMutability: "nonpayable",
    inputs: [
      {name: "assetId", type: "uint256"},
      {name: "premiumReserve", type: "uint256"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleDefault",
    stateMutability: "nonpayable",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [],
  },
] as const;

export const vaultAbi = [
  {
    type: "function",
    name: "availableToBorrow",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "outstanding",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "isDefaulted",
    stateMutability: "view",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "borrow",
    stateMutability: "nonpayable",
    inputs: [
      {name: "assetId", type: "uint256"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "repay",
    stateMutability: "nonpayable",
    inputs: [
      {name: "assetId", type: "uint256"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [{type: "uint256"}],
  },
] as const;

export const registryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      {name: "to", type: "address"},
      {
        name: "data",
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
    outputs: [{type: "uint256"}],
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
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      {name: "operator", type: "address"},
      {name: "approved", type: "bool"},
    ],
    outputs: [],
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
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint8"}],
  },
] as const;
