# LADING — Product Requirements Document

**Version** 2.0 · **Status** Build · **Target** BOT Chain Mainnet (chain 677)
**Submission deadline** 2026-08-22 23:59 UTC+8 · **Track** RWA Applications

> **The load moved. The money didn't.**
>
> Illiquidity is not a property of an asset. It is an unpriced risk.
> Price it, and any real-world asset becomes lendable.

---

## 1. Problem

A truck delivers a load on Monday. The shipper pays in 90 days. The carrier needs diesel on Tuesday.

Freight is one of the largest cash-flow-inverted industries on earth. The work is performed first and paid for last, and the gap is financed by whoever can least afford it. Factoring exists, charges 2–5% per invoice, takes days, and rejects anyone without a credit file.

DeFi cannot fix this today, because DeFi lending is only solvent when liquidation is instant: default, seize, sell on an orderbook, repay. That model requires a liquid market for the collateral.

**A freight invoice has no orderbook.** A single receivable against a single shipper cannot be sold in a block. So every RWA lending protocol picks one of three failing strategies:

| Strategy | Failure mode |
|---|---|
| Over-collateralise 2–3× | Destroys the economic purpose of borrowing |
| Whitelist institutions with legal recourse | Reintroduces the trusted third party; does not scale |
| Lend on trust | Goldfinch: ~$18M defaults, wound down June 2026, token −99.8% |

**Market size.** The global trade-finance gap has held at **$2.5T (~10% of world trade)** since 2023. **41% of SME trade-finance requests are rejected.** Freight and logistics are the largest single slice of that rejection.

**Root cause.** Nobody has built a liquidation engine that works without a secondary market.

---

## 2. Solution

LADING is a **non-custodial marketplace for contestable firm bids on freight receivables.**

Before a loan exists, an underwriter posts a **firm purchase bid** at price `F` and **escrows `F` in full**. In exchange they earn a continuously accruing premium. If the borrower defaults, the escrow settles to the lender and the invoice transfers to the underwriter — atomically, in one block, with no auction, no oracle, and no market.

The bid slot is **permanently contestable**: anyone may displace the incumbent by posting strictly better terms — higher `F`, or equal `F` at a lower premium.

### 2.1 Emergent properties

1. **Price discovery without a market.** Competition to *purchase* produces a live, capital-backed valuation for a unique asset.
2. **Governance-free risk parameters.** `maxLoan = F × (1 − haircut)`. Uncontested bids decay per block, deleveraging positions in real time without a vote.
3. **Authenticity via incentive.** The underwriter eats the loss on a fake load. They perform genuine diligence because they are buying, not insuring. Incentive alignment replaces oracle attestation.
4. **Honest rejection.** No bid means the invoice is not financeable, and the protocol says so. Absence of a bid is information, not a failure state.

### 2.2 The underwriters are AI agents

Human underwriters do not exist on day one. LADING ships with **autonomous agent underwriters**: each holds its own EOA, watches new slots, reads the invoice and debtor, prices the risk, and **escrows its own capital** against being wrong.

The agent is not a chatbot bolted to the side. It is the economic actor that bears the loss. Division of labour inside the agent is deliberate:

- **The model exercises judgment** — reads the load details, shipper identity, and terms; emits a risk grade plus a written rationale.
- **Deterministic code sets the price** — grade maps to floor `F` and premium via a fixed formula.

The rationale is hashed on-chain alongside the bid. The agent's reasoning is committed as firmly as its capital. This solves the cold-start problem and makes the auction live from block one.

### 2.3 Prior art, and the difference

Paradigm's **Blend** (2023) established oracle-free lending against illiquid NFT collateral via a Dutch refinancing auction — if the auction fails, the lender seizes the collateral. LADING differs in four load-bearing ways:

- **Blend funds nothing up front.** Whether anyone will take the position is discovered *at* the auction. LADING escrows the full purchase price **before origination**. The loss floor is funded before the loan exists.
- **Blend's auction fires on exit** and descends. LADING's slot is permanently live and ascends.
- **Blend is two-party.** LADING separates lender from underwriter: the party pricing the asset is not the party funding the loan.
- **Blend needs a floor price.** Freight invoices have no floor and no comparable set.

---

## 3. Users

| Persona | Need | LADING delivers |
|---|---|---|
| **Carrier** — owner-operator or small fleet | Diesel and payroll now, not in 90 days | Credit at a market-derived LTV, minutes not weeks |
| **Underwriter** — agent or freight-credit specialist | Yield on idle capital in a domain they can read | Continuous premium on escrowed capital; acquires the invoice at a self-set price on default |
| **Lender** — stablecoin capital | Real yield with bounded, knowable downside | Loss floor escrowed on-chain *before* origination |

**Primary persona for v1: the carrier.** The product surface is carrier-first — submit an invoice, watch underwriters compete, take the loan.

---

## 4. Scope

### 4.1 v1 — ships by 2026-08-22

| ID | Requirement | State |
|---|---|---|
| F-01 | Register a freight invoice as collateral (ERC-721 record) | ✅ `AssetRegistry` |
| F-02 | Open a firm-bid slot against a registered invoice | ✅ `FirmBidMarket.openSlot` |
| F-03 | Underwriter posts bid with full escrow | ✅ `FirmBidMarket.bid` |
| F-04 | Contest a slot with strictly-better terms; incumbent refunded | ✅ shipped |
| F-05 | Per-block premium accrual (index-based, O(1)) | ✅ shipped |
| F-06 | Per-block floor decay on uncontested slots | ✅ `tick` / `currentFloor` |
| F-07 | Originate loan at derived LTV | ⬜ `LoanVault` |
| F-08 | Repay loan; release escrow and collateral | ⬜ `LoanVault` |
| F-09 | Default → atomic settlement (escrow→lender, invoice→underwriter) | ✅ `settleDefault` |
| F-10 | Pluggable `ICompliance` allowlist gate | ✅ shipped |
| F-11 | Carrier dashboard: submit, watch auction, take loan, repay | ⬜ |
| F-12 | Agent underwriters: price, bid, contest, withdraw | ⬜ |
| F-13 | Live auction feed | ⬜ (contract views, polled) |

The novel mechanism is already built and invariant-tested. What remains is one standard vault, a UI, and the agents.

### 4.2 Deliberately cut for v1

Indexer · backend API · database · job queue · upgradeable proxies · timelock · underwriter console · secondary market for slots · tranching · multi-asset portfolios · credit history · jurisdiction modules.

Reads come straight from contract view functions. On a sub-second-finality chain that is fast enough to feel live, and it removes an entire tier of infrastructure from the critical path.

### 4.3 Explicit non-goals

Not an issuer. Not a custodian. Not a loan originator of record. Not an insurer — bids are **purchase commitments**, never guarantees.

---

## 5. Success metrics

| Metric | v1 target |
|---|---|
| Time from invoice submission to funded loan | < 10 min |
| Slots with ≥ 2 competing underwriters | ≥ 50% |
| Default settlement latency | single block |
| Agents producing materially different prices | 100% — divergence is the proof they are reasoning |

---

## 6. Compliance posture

Not legal advice. Structural choices that minimise regulatory surface:

- **Firm bid, not guarantee.** The underwriter *purchases an asset*; they do not indemnify a loss. A forward purchase commitment is not financial guaranty insurance. The words "insurance", "guarantee", "protection", and "coverage" appear nowhere in code, UI, or marketing.
- **B2B only.** Business borrowers exclusively. Consumer credit regimes do not apply.
- **Freight receivables as collateral.** Assignment of receivables is settled law (UCC Art. 9 and equivalents). Domestic freight avoids cross-border jurisdiction stacking. Not a security.
- **Non-custodial.** The protocol matches and escrows. Never originates, never holds fiat, never holds keys.
- **Permissioned by default.** `ICompliance` gates borrow / lend / underwrite. Allowlist in v1.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Asset authenticity — no real invoice by deadline | **High** | Use one genuine invoice with a real named shipper and its document hash on-chain. Never fabricate a debtor; a labelled demo asset beats a fake one. |
| Agents converge on identical prices | **High** | Three agents with genuinely different risk appetites. Identical output reads as one script with three keys and kills the innovation claim. |
| Read as a Blend derivative | Medium | Lead with escrow-before-origination (§2.3) in the README, the demo, and the video. |
| Carrier–underwriter collusion on inflated `F` | Medium | Sustaining a fake floor burns real locked capital every block; open contest lets honest bidders undercut. |
| Escrow insolvency | Critical | Escrow is pre-funded, never a promise. Invariant-tested: `escrow ≥ floor`, always. |
| Rule 4 overlap with prior Challenge entries | High | **Open action:** audit BOT Chain Builder Challenge #1 submissions before submitting. |
