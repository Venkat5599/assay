/** The full ABI surface the carrier, lender and underwriter flows touch. */

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
    name: "minImprovementBps",
    stateMutability: "view",
    inputs: [],
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
    name: "fundPremium",
    stateMutability: "nonpayable",
    inputs: [
      {name: "assetId", type: "uint256"},
      {name: "amount", type: "uint256"},
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "claimPremium",
    stateMutability: "nonpayable",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [{type: "uint256"}],
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
    name: "closeSlot",
    stateMutability: "nonpayable",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [],
  },
  {
    type: "function",
    name: "decayRatePerBlock",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint128"}],
  },
  {
    type: "function",
    name: "settleDefault",
    stateMutability: "nonpayable",
    inputs: [{name: "assetId", type: "uint256"}],
    outputs: [],
  },
  {
    type: "event",
    name: "BidPlaced",
    inputs: [
      {name: "assetId", type: "uint256", indexed: true},
      {name: "underwriter", type: "address", indexed: true},
      {name: "displaced", type: "address", indexed: true},
      {name: "floor", type: "uint256", indexed: false},
      {name: "premiumRate", type: "uint128", indexed: false},
    ],
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
    name: "totalAssets",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "totalIdle",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "sharesOf",
    stateMutability: "view",
    inputs: [{name: "lender", type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "convertToAssets",
    stateMutability: "view",
    inputs: [{name: "shares", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "nonpayable",
    inputs: [{name: "amount", type: "uint256"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{name: "shares", type: "uint256"}],
    outputs: [{type: "uint256"}],
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
  {
    type: "function",
    name: "claimable",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "claimSurplus",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "badDebt",
    stateMutability: "view",
    inputs: [],
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
    name: "exists",
    stateMutability: "view",
    inputs: [{name: "id", type: "uint256"}],
    outputs: [{type: "bool"}],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{name: "id", type: "uint256"}],
    outputs: [{type: "address"}],
  },
  {
    type: "function",
    name: "isApprovedForAll",
    stateMutability: "view",
    inputs: [
      {name: "owner", type: "address"},
      {name: "operator", type: "address"},
    ],
    outputs: [{type: "bool"}],
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
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint8"}],
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
] as const;

export const counterpartyAbi = [
  {
    type: "function",
    name: "entityOf",
    stateMutability: "view",
    inputs: [{name: "account", type: "address"}],
    outputs: [
      {
        type: "tuple",
        components: [
          {name: "name", type: "string"},
          {name: "jurisdiction", type: "string"},
          {name: "role", type: "uint8"},
          {name: "status", type: "uint8"},
          {name: "registeredAt", type: "uint64"},
          {name: "evidenceHash", type: "bytes32"},
        ],
      },
    ],
  },
  {
    type: "function",
    name: "accounts",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "address[]"}],
  },
  {
    type: "function",
    name: "count",
    stateMutability: "view",
    inputs: [],
    outputs: [{type: "uint256"}],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      {name: "account", type: "address"},
      {name: "name", type: "string"},
      {name: "role", type: "uint8"},
      {name: "jurisdiction", type: "string"},
      {name: "evidenceHash", type: "bytes32"},
    ],
    outputs: [],
  },
] as const;
