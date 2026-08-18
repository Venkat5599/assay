# LADING — System Architecture

**Version** 2.0 · **Target** BOT Chain Mainnet (chain 677, EVM)
**Constraint** everything below ships by 2026-08-22.

---

## 0. The one architectural decision

**There is no backend.**

`FirmBidMarket` already exposes `slots()`, `currentFloor()`, and `maxBorrow()` as view functions. That is the read API. The frontend polls the chain directly through viem.

This deletes the indexer, the database, the API server, the cache, the queue, and the keeper fleet from the critical path. On a sub-second-finality chain the auction feed still feels live. Every hour not spent on infrastructure is an hour spent on the loop a judge actually clicks through.

The v1.0 architecture specified Ponder, Postgres, Drizzle, Hono, Redis, BullMQ, UUPS proxies, a 48h timelock, Medusa, Tenderly, Sentry, PostHog, and OpenTelemetry. All of it is correct for a production system and none of it is deliverable in three days. It is cut, not deferred to a sprint that does not exist.

---

## 1. Stack

### 1.1 Protocol

| Concern | Choice | Rationale |
|---|---|---|
| Language | **Solidity 0.8.28** | Transient storage available for reentrancy guards |
| Toolchain | **Foundry** | Fastest loop; native fuzzing and invariant testing in Solidity |
| Libraries | **OpenZeppelin 5.x** + **Solady** | OZ for audited standards; Solady for gas-critical ERC-721 |
| Fixed point | **RAY (1e27)** via `RayMath` | Aave/Maker convention; no precision loss in per-block accrual |
| Upgradeability | **None.** Immutable deploys | A proxy you cannot audit in three days is a liability, not a feature |
| Testing | `forge test` — unit + stateful invariant | Already green: 7 unit, 7 invariant |

### 1.2 Agents

| Concern | Choice |
|---|---|
| Runtime | **Bun** + TypeScript (strict) |
| Chain client | **viem 2.x** |
| Judgment | LLM call → risk grade + rationale string |
| Pricing | Deterministic TypeScript: grade → `F`, premium |
| Keys | One EOA per agent, funded with minimal capital |

### 1.3 Interface

| Concern | Choice |
|---|---|
| Framework | **Next.js 15** (App Router) + React 19 |
| Wallet | **wagmi 2.x** + **viem** + ConnectKit |
| Reads | `useReadContract` polling on a short interval |
| Styling | **Tailwind 4** + shadcn/ui, art-directed |
| Motion | **Motion** (`motion/react`) |

### 1.4 Platform

Frontend **Vercel** · Agents **any always-on host** (Railway/Fly/a VPS) · CI **GitHub Actions** running `forge test`.

---

## 2. Topology

```
┌──────────────────────────────────────────────┐
│  Next.js (Vercel)                            │
│  carrier dashboard · live auction feed       │
└───────────────┬──────────────────────────────┘
                │ wagmi/viem — reads AND writes
                ▼
┌──────────────────────────────────────────────┐
│  BOT Chain (677)                             │
│  ├ AssetRegistry        ERC-721 invoice      │
│  ├ FirmBidMarket        bids · premium ·     │
│  │                      decay · settlement   │
│  ├ LoanVault            borrow · repay       │
│  └ AllowlistCompliance  gate                 │
└───────────────▲──────────────────────────────┘
                │ bid · contest · withdraw
┌───────────────┴──────────────────────────────┐
│  Agent underwriters (Bun)                    │
│  conservative · aggressive · sector-focused  │
└──────────────────────────────────────────────┘
```

Three arrows. That is the whole system.

---

## 3. Contracts

### 3.1 Inventory

| Contract | State | Responsibility |
|---|---|---|
| `AssetRegistry` | ✅ 90 lines | ERC-721 record: shipper, face value, due date, document hash |
| `FirmBidMarket` | ✅ 436 lines | Slots, escrowed bids, contest, premium accrual, floor decay, atomic settlement |
| `AllowlistCompliance` | ✅ 55 lines | `ICompliance` allowlist gate |
| `RayMath` | ✅ 60 lines | RAY fixed-point |
| `LoanVault` | ⬜ **the only contract left** | `outstanding` · `isDefaulted` · `absorbSettlement` + borrow/repay |

### 3.2 `FirmBidMarket` surface (built)

```
openSlot(assetId, premiumReserve)     bid(assetId, floor, premiumRate)
fundPremium(assetId, amount)          withdrawBid(assetId)
claimPremium(assetId)                 closeSlot(assetId)
settleDefault(assetId)                tick(assetId)
currentFloor(assetId) view            maxBorrow(assetId) view
slots(assetId) view
```

### 3.3 `LoanVault` — what remains

Implements `ILoanVault`, which the market already calls:

```solidity
function outstanding(uint256 assetId) external view returns (uint256);
function isDefaulted(uint256 assetId) external view returns (bool);
function absorbSettlement(uint256 assetId, uint256 amount) external;
```

Plus the borrower path: `borrow(assetId, amount)` capped at `market.maxBorrow(assetId)`, `repay(assetId, amount)`, linear interest accrual, and a default flag on maturity breach. Standard vault mechanics — roughly 150 lines. No novel logic; the novelty is entirely in the market.

**Invariants to add:** `outstanding ≤ maxBorrow` at origination · repayment monotonically reduces debt · `absorbSettlement` callable only by the market.

---

## 4. Agent design

Three agents, deliberately divergent. Identical prices from three keys reads as one script and destroys the innovation claim.

| Agent | Mandate |
|---|---|
| `conservative` | Bids low, wide haircut, only well-known shippers |
| `aggressive` | Bids near face value, thin premium, accepts unknown debtors |
| `sector` | Only one lane or shipper type; ignores everything else |

**Loop:** poll for open slots → read invoice from `AssetRegistry` → LLM emits risk grade + rationale → formula maps grade to `F` and premium → compare against the live `currentFloor` → bid, contest, or abstain → hold, and withdraw when decay makes the position unprofitable.

**Why the split matters.** An LLM emitting a raw price is fragile and a judge will poke at it. An LLM emitting a *risk grade with a written rationale*, converted to a price by auditable arithmetic, is defensible. Surface the rationale next to each bid in the UI and hash it on-chain with the bid.

---

## 5. Frontend

Single carrier-first flow. Four screens, one loop.

| Screen | Contract calls |
|---|---|
| Submit invoice | `AssetRegistry.register` → `FirmBidMarket.openSlot` |
| Watch auction | poll `slots`, `currentFloor`, `maxBorrow` |
| Take loan | `LoanVault.borrow` |
| Repay | `LoanVault.repay` |

The auction screen is the product. It shows the floor rising as agents contest, the premium moving, decay ticking down when nobody bids, and each agent's rationale beside its number. That screen is the 15% User Experience score and most of the 20% Innovation score.

---

## 6. Build order

Each step leaves the project submittable.

1. **`LoanVault` + tests.** Unblocks F-07 and F-08.
2. **Deploy to mainnet 677, verify on scan.botchain.ai.** Eligibility gate — do this before the UI, not after.
3. **Carrier flow.** Submit → watch → borrow → repay, wallet-connected.
4. **Agents.** Three of them, running live against mainnet.
5. **Demo video.** Record the default settlement: escrow to lender, invoice to underwriter, atomic, one block, no oracle.

Cut from the bottom if the clock runs out.

---

## 7. Deployment

```
contracts/script/Deploy.s.sol   forge script --broadcast --verify
```

Order: `AllowlistCompliance` → `AssetRegistry` → `FirmBidMarket` → `LoanVault` → wire `setCompliance` / `setLoanVault` → allowlist the demo accounts and the three agent EOAs.

Config already in `foundry.toml`: `rpc_endpoints.botchain`, `etherscan.botchain` at chain 677. Needs `BOTCHAIN_RPC_URL`, `BOTSCAN_API_KEY`, `BOTSCAN_VERIFIER_URL`.

Record every deployed address in `README.md` with its explorer link. That table is 25% of the score.
