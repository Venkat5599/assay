# PLINTH — System Architecture

**Version** 1.0 · **Target** BOT Chain Mainnet (chain 677, EVM)

---

## 1. Stack

Chosen for what serious on-chain teams actually run in production — not for novelty.

### 1.1 Protocol layer

| Concern | Choice | Rationale |
|---|---|---|
| Language | **Solidity 0.8.28** | Native EVM; transient storage available for reentrancy guards |
| Toolchain | **Foundry** (forge / anvil / cast / chisel) | Fastest test loop; native fuzzing and invariant testing in Solidity |
| Libraries | **OpenZeppelin 5.x** + **Solady** | OZ for audited standards; Solady for gas-critical math and ERC-721 |
| Upgradeability | **UUPS proxy + 48h Timelock** | Upgradeable without proxy-admin footguns; timelock removes unilateral upgrade risk |
| Fixed point | **RAY (1e27)**, PRBMath for exponentials | Matches Aave/Maker convention; avoids precision loss in per-block accrual |
| Static analysis | **Slither**, **Aderyn** | CI-gated, zero tolerance on high severity |
| Fuzz / invariant | **forge invariant**, **Medusa** | Stateful fuzzing over auction and escrow accounting |
| Simulation & alerts | **Tenderly** | Tx simulation in CI; production alerting on settlement events |

### 1.2 Application layer

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** + TypeScript (strict) | One toolchain across API, indexer, workers |
| Indexer | **Ponder** | Typed, Postgres-backed, reorg-safe, hot reload. Better fit than a subgraph for a Postgres-centric backend |
| API | **Hono** + OpenAPI + Zod | Minimal, edge-portable, schema-first contracts |
| Database | **Postgres (Neon)** + **Drizzle ORM** | Branchable DBs per PR; typed migrations |
| Cache / queue | **Redis (Upstash)** + **BullMQ** | Keeper jobs, decay materialisation, notification fanout |
| Chain client | **viem 2.x** | Type-safe, tree-shakeable, current standard |

### 1.3 Interface layer

| Concern | Choice |
|---|---|
| Framework | **Next.js 15** (App Router, RSC) + **React 19** |
| Wallet | **wagmi 2.x** + **viem** + **ConnectKit** |
| Server state | **TanStack Query 5** |
| Styling | **Tailwind 4** + **shadcn/ui** (art-directed, not stock) |
| Motion | **Motion** (`motion/react`) |
| Realtime | SSE from the API for live auction state |

### 1.4 Platform

CI **GitHub Actions** · Frontend **Vercel** · Services **Railway** · DB **Neon** · Cache **Upstash** · Errors **Sentry** · Product analytics **PostHog** · Tracing **OpenTelemetry → Grafana Cloud**

---

## 2. Topology

```
┌────────────────────────────────────────────────────────────┐
│  Next.js 15 (Vercel)                                       │
│  borrower dashboard · underwriter console · auction feed   │
└───────────────┬──────────────────────────┬─────────────────┘
                │ wagmi/viem (writes)      │ REST + SSE (reads)
                ▼                          ▼
┌──────────────────────────┐   ┌────────────────────────────┐
│  BOT Chain (677)         │   │  Hono API (Railway)        │
│  ├ FirmBidMarket         │   │  ├ auction & loan queries  │
│  ├ LoanVault             │   │  ├ analytics               │
│  ├ SettlementEngine      │   │  └ SSE live feed           │
│  ├ AssetRegistry (721)   │   └──────────┬─────────────────┘
│  ├ ComplianceModule      │              │
│  └ Treasury              │              ▼
└──────────┬───────────────┘   ┌────────────────────────────┐
           │ logs              │  Postgres (Neon)           │
           ▼                   └──────────▲─────────────────┘
┌──────────────────────────┐              │
│  Ponder indexer          │──────────────┘
└──────────────────────────┘
┌──────────────────────────┐
│  Keeper workers (BullMQ) │  default triggers · decay ticks · alerts
└──────────────────────────┘
```

**Reads never touch the chain.** The indexer is the read path; the chain is the write path and the source of truth. That separation is what keeps the auction feed fast enough to feel live.

---

## 3. Contracts

### 3.1 Inventory

| Contract | Responsibility |
|---|---|
| `AssetRegistry` | ERC-721 record of a receivable: debtor, face value, due date, document hash |
| `FirmBidMarket` | Bid slots, escrow, `contest()`, premium accrual, floor decay |
| `LoanVault` | Origination at derived LTV, repayment, default detection |
| `SettlementEngine` | Atomic escrow↔asset swap on default |
| `ComplianceModule` | `ICompliance` implementation; allowlist in v1 |
| `Treasury` | Protocol fee accrual and withdrawal |

### 3.2 Core state

```solidity
struct Slot {
    address underwriter;
    uint256 floor;         // F — firm bid price
    uint256 escrow;        // pre-funded; invariant: escrow >= floor
    uint256 premiumRate;   // per-block, RAY
    uint256 accrued;       // premium owed to underwriter
    uint64  lastTick;      // block of last accrual
    uint64  decayRate;     // per-block floor decay, RAY
}
```

### 3.3 Contest — the central mechanism

```solidity
function contest(uint256 assetId, uint256 newFloor, uint256 newRate)
    external nonReentrant
{
    require(compliance.canUnderwrite(msg.sender), "not permitted");
    Slot storage s = slots[assetId];
    _tick(assetId);

    // strictly better on at least one axis, no worse on either
    require(newFloor >= s.floor && newRate <= s.premiumRate, "not better");
    require(newFloor > s.floor || newRate < s.premiumRate, "no improvement");
    require(newFloor >= vault.outstanding(assetId), "below outstanding debt");

    escrowToken.safeTransferFrom(msg.sender, address(this), newFloor);

    address prev   = s.underwriter;
    uint256 refund = s.escrow;
    uint256 owed   = s.accrued;

    s.underwriter = msg.sender;
    s.floor       = newFloor;
    s.escrow      = newFloor;
    s.premiumRate = newRate;
    s.accrued     = 0;
    s.lastTick    = uint64(block.number);

    if (prev != address(0)) {
        escrowToken.safeTransfer(prev, refund + owed);   // CEI: state first
    }
    emit SlotContested(assetId, prev, msg.sender, newFloor, newRate);
}
```

### 3.4 Accrual and decay — lazy, O(1)

```solidity
function _tick(uint256 assetId) internal {
    Slot storage s = slots[assetId];
    uint256 n = block.number - s.lastTick;
    if (n == 0) return;

    s.accrued += (s.floor * s.premiumRate * n) / RAY;

    if (s.decayRate != 0) {
        // compounding decay; rpow avoids linear-approximation drift
        s.floor = (s.floor * (RAY - s.decayRate).rpow(n, RAY)) / RAY;
    }
    s.lastTick = uint64(block.number);
}
```

No loops over participants. Cost is constant regardless of slot count or elapsed blocks.

### 3.5 Settlement

```solidity
function settleDefault(uint256 assetId) external nonReentrant {
    require(vault.isDefaulted(assetId), "not defaulted");
    Slot storage s = slots[assetId];
    _tick(assetId);

    uint256 escrow = s.escrow;
    address uw     = s.underwriter;
    delete slots[assetId];                              // effects

    escrowToken.safeTransfer(address(vault), escrow);   // interactions
    vault.absorb(assetId, escrow);
    assetRegistry.transferFrom(address(this), uw, assetId);

    emit Settled(assetId, uw, escrow);
}
```

One block. No auction, no oracle, no external market.

---

## 4. Invariants

Enforced by `forge invariant` and Medusa. These are the safety argument.

| ID | Invariant |
|---|---|
| INV-1 | `slot.escrow >= slot.floor` for every active slot |
| INV-2 | `escrowToken.balanceOf(market) >= Σ(escrow + accrued)` |
| INV-3 | `contest()` never decreases `floor` and never increases `premiumRate` |
| INV-4 | `vault.outstanding(assetId) <= slot.floor × (1 − haircut)` at all times |
| INV-5 | A displaced underwriter is always refunded `escrow + accrued` in full |
| INV-6 | Settlement is atomic — escrow and asset both move, or neither does |
| INV-7 | `_tick` is idempotent within a block |

INV-4 matters most: it is what makes floor decay a real deleveraging mechanism rather than a cosmetic number.

---

## 5. Security

**Reentrancy** — CEI ordering throughout; `nonReentrant` on all external state mutators; transient-storage guard (EIP-1153) where supported.

**Oracle risk** — none. The protocol reads no external price feed by design. `F` originates from escrowed capital.

**Precision** — RAY fixed point; `rpow` for compounding; rounding always against the actor requesting value.

**Access control** — `AccessControlDefaultAdminRules`; admin is a 48h Timelock behind a multisig.

**Upgrades** — UUPS, timelocked, storage-gap reservations on every upgradeable contract.

**Front-running** — contest requires strictly-better terms, so a "snipe" is only ever a better deal for the borrower. Sub-second blocks compress the window such that marginal sniping does not clear gas cost. **Benchmark and publish the measured threshold.**

**Griefing** — minimum improvement delta and minimum slot dwell time prevent contest spam.

CI gates: `forge test` · `forge coverage ≥ 90%` on core · Slither high/medium = 0 · Aderyn clean · gas snapshot diff on every PR.

---

## 6. Data model (indexer → Postgres)

```
assets        (id, debtor, face_value, due_date, doc_hash, owner, status)
slots         (asset_id, underwriter, floor, escrow, premium_rate, decay_rate, block)
slot_history  (asset_id, block, floor, premium_rate, underwriter, event)
loans         (asset_id, lender, principal, ltv, originated_at, status)
settlements   (asset_id, underwriter, escrow_paid, block, tx_hash)
```

`slot_history` is the long-term moat: a time series of capital-backed valuations for assets that have no market price. Nothing else can produce this dataset, because it exists only as a byproduct of real bidding.

---

## 7. Delivery plan

### Ships by 2026-08-22

| Day | Deliverable |
|---|---|
| **D1** | `AssetRegistry`, `FirmBidMarket` (escrow, `contest`, `_tick`), INV-1/2/3/5/7 |
| **D2** | `LoanVault` (derived LTV, repay, default), `ComplianceModule`, INV-4 |
| **D3** | `SettlementEngine` + INV-6. Slither/Aderyn clean. **Deploy to mainnet, verify on scan** |
| **D4** | Ponder indexer, Hono API, Next.js borrower dashboard + auction feed |
| **D5** | Underwriter console, fraud-rejection demo, gas benchmarks, README, video |

**Cut order under pressure:** underwriter console → floor decay → indexer (read direct from chain).

**Never cut:** escrow invariants, atomic settlement, the borrower loop.

### Deferred to production

Tranched syndicates · slot secondary market · underwriter reputation · jurisdictional compliance modules · institutional API · external audit · cross-chain collateral

---

## 8. Open items — resolve before writing contracts

1. **Verify BOT Chain parameters directly.** Chain ID, RPC, gas token, EVM version (does it support EIP-1153 transient storage?), measured block time and finality. Published docs returned HTTP 403; current figures are unverified.
2. **Audit Builder Challenge #1 submissions** for overlap under Rule 4. Disqualification risk.
3. **Confirm a stablecoin** on BOT Chain mainnet for escrow denomination.
