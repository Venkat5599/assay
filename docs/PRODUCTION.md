# LADING — Production Architecture

**Horizon** post-hackathon, operating as a company · **Status** target state

`ARCHITECTURE.md` is what ships by 2026-08-22. This is what LADING looks like when it holds other people's money. The two documents are deliberately separate: shipping scope and target state should never be edited into each other.

---

## 0. What changes when it is real

The hackathon build has one adversary: a judge with a wallet. Production has four, and the stack is a response to them.

| Adversary | Attack | What must exist |
|---|---|---|
| **The fraudulent carrier** | Finances one invoice twice — at LADING and at a traditional factor | Duplicate-financing detection. This is the #1 loss vector in freight factoring, ahead of credit risk. |
| **The fake load** | Registers an invoice for freight that never moved | Shipper-side confirmation, not carrier attestation |
| **The contract attacker** | Drains escrow | Immutable core, formal verification, real audits, bounded blast radius |
| **The regulator** | Asks who you lent to and under what disclosure | KYB, sanctions screening, UCC-1 perfection, state disclosure compliance |

Credit risk is the one everyone designs for and the smallest of the four. The firm-bid mechanism already prices credit risk. **It does not price fraud**, and fraud is what kills factoring companies.

---

## 1. Protocol layer

### 1.1 Contract topology

**Immutable core, swappable periphery.** The escrow and settlement math never changes; everything policy-shaped does.

| Layer | Contracts | Upgradeable |
|---|---|---|
| Core | `FirmBidMarket`, `LoanVault`, `AssetRegistry` | **Never.** Deploy a new version and migrate. |
| Policy | `ICompliance` module, haircut curve, decay curve, fee schedule | Yes, behind timelock |
| Periphery | Routers, batchers, view aggregators | Freely |

Escrow custody living behind a proxy means the upgrade key is the real collateral. It does not go behind a proxy. Ever.

### 1.2 Governance

Safe multisig (3/5, hardware keys, geographically separated) → OpenZeppelin Governor + Timelock as capital grows.

**Timelock: 48h on policy, 7 days on anything touching fee routing.** The public queue is the security property — it gives users time to exit before a change lands.

### 1.3 Circuit breakers

Asymmetric by design:

- **Pausable:** new slot creation, new bids, new originations
- **Never pausable:** `withdrawBid`, `repay`, `claimPremium`, `settleDefault`

A pause that traps user capital converts a protocol incident into a run. Exits stay open under every condition, including the incident where you most want to close them.

### 1.4 Assurance

| Layer | Choice | Why |
|---|---|---|
| Invariant testing | Foundry + **Medusa** | Already the foundation; extend the existing suite |
| Formal verification | **Certora** on escrow invariants | `escrow ≥ floor` and settlement conservation are exactly what FV proves well |
| Audit 1 | Boutique firm, full scope | Mechanism is novel — needs reviewers who will reason about it, not diff it against Aave |
| Audit 2 | **Independent** second firm | Two firms that never spoke to each other beats one firm twice |
| Competitive | Cantina or Code4rena | Breadth after depth |
| Bounty | **Immunefi**, scaled to TVL | Permanent, not a launch event |

Ship order: invariants → FV → audit → competitive → bounty. Never audit before your own invariant suite is exhausted; you are paying senior people to find what a fuzzer finds free.

### 1.5 Runtime monitoring

**OpenZeppelin Defender Sentinels** + **Forta** on: settlement events, escrow balance deltas, unusual bid velocity, any owner-function call. Paged, not emailed.

Daily **reconciliation job** — on-chain escrow total vs. the off-chain ledger. Any drift is a page. This single job catches more real problems than every dashboard combined.

---

## 2. The off-chain layer — where the moat actually is

The contracts are copyable. This layer is not.

### 2.1 Duplicate-financing prevention

The core defence. On registration, derive a canonical invoice identity — `(shipper EIN, invoice number, load reference, amount)` — hash it, and write the hash as a **nullifier** in `AssetRegistry`. Second registration of the same identity reverts.

That stops double-financing *within* LADING. Stopping it *across* the industry needs external data:

- Cross-check against factoring industry registries where accessible
- Shipper-side confirmation makes the same invoice hard to represent twice
- Long term, the nullifier set is a public good worth publishing — it makes LADING infrastructure, not just a lender

Commercial detail leaks through a raw hash if the field space is guessable, so commit to a salted identity and hold the salt with the document.

### 2.2 Invoice verification

Carrier attestation is worth nothing. Verification comes from the shipper's side of the transaction:

| Source | What it proves |
|---|---|
| **TMS integration** (McLeod, Samsara) | The load exists in the carrier's own system of record |
| **Load board** (DAT, Truckstop) | The load was posted and booked |
| **Visibility platform** (project44, FourKites) | The freight physically moved |
| **ELD telematics** | The truck was where the bill of lading says it was |

Signed bill of lading plus one independent confirmation is the minimum bar for a real invoice. Grade the strength of verification and feed it to the agents as a pricing input — weakly verified invoices should price worse, not be silently rejected.

### 2.3 Document custody

Encrypted object storage (S3 + KMS, customer-managed keys), content-addressed. Only the hash goes on-chain. Retention matched to the statute of limitations on the underlying claim, not to product convenience.

### 2.4 Legal perfection

Assignment of a receivable is not perfected by an ERC-721. **Automated UCC-1 filing** through a filing agent API (CSC, Wolters Kluwer) at origination, with termination on repayment. Without perfection, the underwriter's claim on default is unsecured and the entire settlement guarantee is decorative.

### 2.5 Identity and screening

- **KYB:** Persona or Sumsub — entity verification, beneficial ownership, EIN validation
- **Sanctions:** Chainalysis or TRM — wallet screening at the `ICompliance` gate, continuous rescreening, not one-time
- **Disclosure:** several US states impose commercial-financing disclosure obligations (California's CFDL among them). Generate the required disclosure at origination as a product feature, not a legal afterthought.

---

## 3. Agent platform

The agents move from "three scripts" to a system that can lose money responsibly.

### 3.1 Architecture

Keep the v1 split and harden it: **the model grades risk, deterministic code sets the price.** Never let a model emit a number that moves capital directly.

```
invoice + verification grade + shipper history
        │
        ▼
  model → risk grade + rationale        ← versioned prompt, pinned model
        │
        ▼
  pricing kernel (pure TypeScript)      ← unit-tested, deterministic, replayable
        │
        ▼
  risk limits → bid
```

### 3.2 Controls

| Control | Mechanism |
|---|---|
| Versioning | Every decision logs model id, prompt version, inputs, rationale, output |
| Replay | Any historical decision re-runnable against a new model version |
| Offline eval | Invoice set with known outcomes; no model ships without beating incumbent |
| Shadow mode | New agent versions price without capital for N days first |
| Capital limits | Per-agent, per-shipper, per-day exposure caps enforced in code |
| Kill switch | One call halts an agent; its open bids decay out rather than being force-withdrawn |

### 3.3 Model

Claude via the Anthropic API for judgment, pinned to an explicit model id. Model upgrades are a deployment with an eval gate, never a silent floating version.

---

## 4. Application layer

Now the backend earns its place — because compliance, verification, and reconciliation are inherently off-chain.

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** + TypeScript strict | One toolchain across API, indexer, agents |
| Indexer | **Ponder** | Typed, Postgres-backed, reorg-safe |
| API | **Hono** + OpenAPI + Zod | Schema-first; the OpenAPI doc becomes the partner integration surface |
| Workflows | **Temporal** | The upgrade that matters most |
| Database | **Postgres** — Neon early, Aurora at SOC 2 | Branch-per-PR early; PITR and compliance posture later |
| Ledger | Double-entry, append-only | See below |
| Cache | Redis | Ordinary |

### 4.1 Why Temporal, not a job queue

Origination is not a job. It is a long-running, multi-party, partially-failing workflow: verify invoice → screen parties → file UCC-1 → wait for bids → originate on-chain → disburse fiat → confirm settlement. Steps take days. Steps fail halfway. Some need compensating actions — a UCC-1 filed against a loan that never originated must be terminated.

BullMQ gives you retries. Temporal gives you durable execution, compensation, and a queryable history of every workflow that ever ran. For a lender, that history *is* the audit trail.

### 4.2 The ledger is not optional

A double-entry, append-only ledger mirroring every on-chain movement, plus every fiat movement the chain never sees. Formance, or hand-rolled in Postgres with hard immutability.

Chain state alone cannot answer "what does this carrier owe us, in dollars, today, including the fiat we wired before the loan settled." Every financial company that skipped this rebuilt it later under audit pressure, at ten times the cost.

---

## 5. Money movement

| Layer | Choice |
|---|---|
| Settlement asset | **USDC**, Circle Mint for direct mint/redeem at scale |
| Fiat off-ramp | **Bridge** (Stripe) or Circle — carrier receives USD to a bank account |
| Treasury custody | **Fireblocks** or Anchorage for protocol treasury and agent capital |
| Gas | Sponsored; a carrier must never need to hold BOT |

Carriers do not want stablecoins. They want diesel. The crypto rails are an implementation detail and the product should let them stay one.

---

## 6. Reliability

- **Observability:** OpenTelemetry → Grafana Cloud. Sentry for exceptions. PostHog for product analytics.
- **SLOs:** submission → funded loan p95; settlement latency p99; agent decision latency; indexer lag.
- **On-call:** real rotation, real runbooks, blameless post-mortems.
- **Incident classes:** contract incident, indexer lag, agent misprice, fiat rail outage. Each with a written runbook before it happens the first time.
- **Chaos:** regularly kill the indexer and an agent in staging. A system whose failure modes are undocumented has undiscovered ones.

---

## 7. Organisation

- **SOC 2 Type II** via Vanta or Drata. Partners will ask before they integrate.
- **Structure:** operating company (product, ops, fiat) separate from protocol governance. Decide before it is expensive to change.
- **Insurance:** E&O and crime/fidelity. Not protocol cover — company cover.
- **Data:** SOC 2 drives retention and access controls; shipper commercial data is sensitive to *them*, not just to you.

---

## 8. Migration path

| Phase | Trigger | Adds |
|---|---|---|
| **0 — Hackathon** | now | `ARCHITECTURE.md` as written |
| **1 — Pilot** | first real carrier | Nullifier registry · one TMS integration · KYB · manual UCC-1 · ledger |
| **2 — Live** | first external capital | Audit · Ponder · Temporal · fiat off-ramp · Defender monitoring · reconciliation |
| **3 — Scale** | TVL past self-funding | Second audit · Certora · Immunefi · Governor + Timelock · SOC 2 · agent eval harness |
| **4 — Infrastructure** | multi-vertical | Nullifier set published · verification grading opened · other verticals on the same core |

Nothing in phase 2+ is built before its trigger fires. Building phase 3 infrastructure during phase 1 is how the v1.0 architecture became undeliverable.

---

## 9. What is deliberately rejected

| Rejected | Why |
|---|---|
| Upgradeable escrow | The upgrade key becomes the real collateral |
| Oracle-priced collateral | The entire thesis is that unique assets have no observable price |
| A governance token at launch | Adds a securities question to a product that has none |
| Pooled/tranched lending | Goldfinch. The escrow is the tranche. |
| LLM emitting prices directly | Non-deterministic, non-replayable, unauditable |
| Multi-chain at launch | Fragments escrow liquidity, which is the one thing that must not fragment |
