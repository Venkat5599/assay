# PLINTH — Product Requirements Document

**Version** 1.0 · **Status** Draft · **Owner** Founding team
**Target** BOT Chain Mainnet (chain 677) · **Hackathon deadline** 2026-08-22

> **Illiquidity is not a property of an asset. It is an unpriced risk.
> Price it, and any real-world asset becomes lendable.**

---

## 1. Problem

DeFi lending is solvent because liquidation is instant: default → seize → sell on an orderbook → repay. That model requires a liquid market for the collateral.

Real-world assets have no orderbook. A single trade receivable, a specific building, a private credit note — none of them can be sold in a block. Every RWA lending protocol therefore chooses one of three failing strategies:

| Strategy | Failure mode |
|---|---|
| Over-collateralise 2–3× | Destroys the economic purpose of borrowing |
| Whitelist institutions with legal recourse | Reintroduces the trusted third party; does not scale |
| Lend on trust | Goldfinch: ~$18M defaults, wound down June 2026, token −99.8% |

**Market impact.** The global trade finance gap has held at **$2.5T (~10% of world trade)** since 2023. **41% of SME trade-finance requests are rejected.** Private credit exceeds $3T; a 1–3% migration on-chain implies $30–90B of tokenised credit instruments, none of which currently have a working liquidation path.

**Root cause.** Nobody has built a liquidation engine that functions without a secondary market.

---

## 2. Solution

PLINTH is a **non-custodial marketplace for contestable firm bids on real-world collateral.**

Before a loan is originated, an underwriter posts a **firm purchase bid** at price `F` and escrows `F` in full. In exchange they earn a continuously accruing premium. If the borrower defaults, the escrow settles to the lender and the collateral transfers to the underwriter — atomically, in one block, with no auction, no oracle, and no market.

The bid slot is **permanently contestable**: any party may displace the incumbent by posting strictly better terms (higher `F`, or equal `F` at lower premium).

### 2.1 Emergent properties

1. **Price discovery without a market.** Competition to purchase produces a live, capital-backed valuation for a unique asset.
2. **Governance-free risk parameters.** `maxLoan = F × (1 − haircut)`. Uncontested bids decay per block, deleveraging positions in real time without a vote.
3. **Authenticity via incentive.** The underwriter bears the loss on a fraudulent asset, so they perform genuine diligence. Incentive alignment replaces oracle attestation.
4. **Honest rejection.** If no bid arrives, the asset is not lendable and the protocol says so. Absence of a bid is information, not a failure state.

---

## 3. Users

| Persona | Need | PLINTH delivers |
|---|---|---|
| **Borrower** — SME with commercial receivables | Working capital against an asset banks reject | Credit at a market-derived LTV, minutes not weeks |
| **Underwriter** — trade-finance / credit specialist | Yield on idle capital in their domain of expertise | Continuous premium on escrowed capital; acquires assets at a self-set price on default |
| **Lender** — stablecoin capital | Real yield with bounded, knowable downside | Loss floor escrowed on-chain before origination |

**Primary persona for v1: the borrower.** The product surface is borrower-first — submit an asset, watch underwriters compete, accept a loan.

---

## 4. Scope

### 4.1 v1 — Hackathon (ships by 2026-08-22)

| ID | Requirement | Priority |
|---|---|---|
| F-01 | Register a trade receivable as collateral (ERC-721 record) | P0 |
| F-02 | Open a firm-bid slot against a registered asset | P0 |
| F-03 | Underwriter posts bid with full escrow | P0 |
| F-04 | Contest a slot with strictly-better terms; incumbent refunded | P0 |
| F-05 | Per-block premium accrual (index-based, O(1)) | P0 |
| F-06 | Per-block floor decay on uncontested slots | P0 |
| F-07 | Originate loan at derived LTV | P0 |
| F-08 | Repay loan; release escrow and collateral | P0 |
| F-09 | Default trigger → atomic settlement (escrow→lender, asset→underwriter) | P0 |
| F-10 | Pluggable `ICompliance` allowlist gate | P0 |
| F-11 | Borrower dashboard: submit, watch auction, accept, repay | P0 |
| F-12 | Underwriter console: browse assets, bid, contest, track premium | P1 |
| F-13 | Public auction feed (live bid/premium/decay) | P1 |

### 4.2 v2 — Post-hackathon production

Tranched underwriting syndicates · Multi-asset portfolios · Secondary market for bid slots · Credit history and underwriter reputation · Jurisdiction-scoped compliance modules · Institutional API · Cross-chain collateral

### 4.3 Explicit non-goals

Not an issuer of the underlying asset. Not a custodian. Not a loan originator of record. Not an insurer — bids are **purchase commitments**, never guarantees.

---

## 5. Success metrics

| Metric | v1 target | Production target |
|---|---|---|
| Time from asset submission to funded loan | < 10 min | < 5 min |
| Bid slots with ≥ 2 competing underwriters | ≥ 50% | ≥ 80% |
| Default settlement latency | < 3 s (single block) | < 3 s |
| Fraudulent assets receiving zero bids | 100% | 100% |
| Protocol take rate on premium flow | — | 10% |

---

## 6. Compliance posture

Not legal advice. Structural choices that minimise regulatory surface:

- **Firm bid, not guarantee.** The underwriter *purchases an asset*; they do not indemnify a loss. This is a forward purchase commitment, not financial guaranty insurance. The words "insurance", "guarantee", "protection", and "coverage" appear nowhere in code, UI, or marketing.
- **B2B only.** Business borrowers exclusively. Consumer credit regimes do not apply.
- **Trade receivables as collateral.** Assignment of receivables is settled law globally (UCC Art. 9 and equivalents). Not a security.
- **Non-custodial.** Protocol matches and escrows. Never originates, never holds fiat, never holds user keys.
- **Permissioned by default.** `ICompliance` gates borrow/lend/underwrite. Allowlist in v1; jurisdiction-configurable thereafter.
- **Target regime:** Singapore MAS, aligned with Project Guardian. Alternates: ADGM, Swiss DLT Act.

---

## 7. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Cold start — no underwriters | High | Seed with own capital; disclose openly; target one receivable vertical |
| Borrower–underwriter collusion on inflated `F` | Medium | Sustaining a fake floor burns real locked capital every block; open contest lets honest bidders undercut |
| Escrow insolvency | Critical | Escrow is pre-funded, never a promise. Invariant-tested: `escrow ≥ floor`, always |
| Regulatory reclassification as insurance | Medium | Firm-bid structure; asset transfers to bidder on settlement |
| Chain-specific dependency unverified | Medium | Benchmark BOT Chain block time and finality directly before launch claims |
| Overlap with prior Challenge entries (Rule 4) | High | **Open action:** audit BOT Chain Builder Challenge #1 submissions before build |
