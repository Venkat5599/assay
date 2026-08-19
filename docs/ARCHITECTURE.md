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
| Testing | `forge test` — unit + stateful invariant | Green: 35 across market, vault, invariants, ontology |

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
| `FirmBidMarket` | ✅ 480 lines | Slots, escrowed bids, contest, premium accrual, floor decay, atomic settlement |
| `AllowlistCompliance` | ✅ 55 lines | `ICompliance` allowlist gate |
| `RayMath` | ✅ 60 lines | RAY fixed-point |
| `LoanVault` | ✅ 374 lines | `outstanding` · `isDefaulted` · `absorbSettlement` + borrow/repay |
| `CounterpartyRegistry` | ✅ 145 lines | Names the parties a receivable points at. Quarantined from market and vault so no settlement path can depend on a name |

### 3.2 `FirmBidMarket` surface (built)

```
openSlot(assetId, premiumReserve)     bid(assetId, floor, premiumRate)
fundPremium(assetId, amount)          withdrawBid(assetId)
claimPremium(assetId)                 closeSlot(assetId)
settleDefault(assetId)                tick(assetId)
currentFloor(assetId) view            maxBorrow(assetId) view
slots(assetId) view
```

### 3.3 Floor decay

The mechanism that makes risk parameters governance-free, and the one that spent
most of this project's life as a struct field nothing assigned. `Slot.decayRate`
was declared, read in `currentFloor` and `_tick`, and never written, so the floor
never moved and the property did not exist.

It is a **protocol** parameter, not a bid parameter. Decay is worth money to the
underwriter, who settles at the decayed floor, and costs the borrower headroom,
so neither party at the table can be trusted to set it. `bid` snapshots the
prevailing rate onto the slot, so an owner transaction can never reprice a
commitment underneath the underwriter who already made it.

A contest resets the clock: `bid` writes a fresh floor and a fresh `lastTick`,
so decay only ever bites an opinion nobody has restated.

| Parameter | Value | Effect on this chain |
|---|---|---|
| `decayRatePerBlock` | 2.15e-8 RAY | ~20% erosion over a 90-day receivable at 0.75s blocks |
| `maxDecayRate` | 1e-6 RAY | ~11%/day ceiling, so no setting erases a floor before anyone reacts |

`_tick` clamps decay at the outstanding debt. A decaying floor compresses
headroom until the position is callable, but can never leave the lender
under-covered.

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
