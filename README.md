# LADING

**The load moved. The money didn't.**

Credit against freight receivables, on BOT Chain. A carrier delivers on Monday, the shipper pays in 90 days, and the carrier needs diesel on Tuesday. LADING closes that gap without a bank, without an oracle, and without a secondary market for the invoice.

---

## The problem

DeFi lending is solvent only because liquidation is instant: default, seize, sell on an orderbook, repay. That requires a liquid market for the collateral.

A freight invoice has no orderbook. One receivable against one shipper cannot be sold in a block. So every RWA lending protocol picks a losing strategy — over-collateralise 2–3× and destroy the point of borrowing, whitelist institutions and reintroduce the trusted third party, or lend on trust (Goldfinch: ~$18M defaults, wound down June 2026).

Nobody built a liquidation engine that works without a secondary market.

## The mechanism

Before any loan exists, an underwriter posts a **firm purchase bid** at price `F` and **escrows `F` in full**. They earn a continuously accruing premium for holding that commitment.

On default, the escrow settles to the lender and the invoice transfers to the underwriter — atomically, in one block. No auction. No oracle. No market.

The slot is **permanently contestable**: anyone may displace the incumbent with a higher floor, or the same floor at a lower premium.

Three things fall out of that:

- **Price discovery without a market.** Competition to *buy* produces a live, capital-backed valuation for an asset that has no comparables.
- **Governance-free risk.** `maxLoan = F × (1 − haircut)`. An uncontested floor decays every block until headroom vanishes and the position becomes callable — no vote, no keeper deciding when.
- **Authenticity via incentive.** The underwriter eats the loss on a fake load, so they do real diligence. Incentive alignment replaces oracle attestation.

If no bid arrives, the invoice is not financeable and the protocol says so. Absence of a bid is information, not a failure state.

## The underwriters are AI agents

LADING ships with autonomous agent underwriters. Each holds its own EOA, reads the load and shipper, prices the risk, and **escrows its own capital** against being wrong.

The split inside the agent is deliberate: **the model exercises judgment** (risk grade plus a written rationale), **deterministic code sets the price** (grade → floor and premium). A model that emits a number directly is unauditable and unreplayable. A model that emits a graded rationale, converted by arithmetic you can read, is neither.

The rationale is committed on-chain with the bid. The agent's reasoning is as pinned as its capital.

## Prior art

Paradigm's [Blend](https://www.paradigm.xyz/2023/05/blend) (2023) established oracle-free lending against illiquid NFT collateral via a Dutch refinancing auction. LADING differs in four ways that matter:

- **Blend funds nothing up front.** Whether anyone will take the position is discovered *at* the auction. LADING escrows the purchase price **before origination** — the loss floor is funded before the loan exists.
- Blend's auction fires **on exit** and descends. LADING's slot is always live and ascends.
- Blend is two-party. LADING separates lender from underwriter, so the party pricing the asset is not the party funding the loan.
- Blend needs a floor price. Freight invoices have no floor and no comparable set.

## Layout

```
contracts/   Foundry — AssetRegistry, FirmBidMarket, LoanVault, compliance
web/         Next.js 16 + wagmi — carrier flow and live auction
docs/        PRD, shipping architecture, production architecture
```

## Contracts

| Contract | Responsibility |
|---|---|
| `AssetRegistry` | ERC-721 record of a receivable: shipper, face value, due date, document hash. Document hashes are unique, so double-pledging the same paperwork is rejected at registration. |
| `FirmBidMarket` | Slots, escrowed bids, contest, premium accrual, floor decay, atomic settlement. Reads no price feed by construction. |
| `LoanVault` | Shared stablecoin pool. Interest by index, borrow capped at market-derived LTV, dual default triggers (maturity and coverage breach). Settlement surplus returns to the borrower, never to lenders. |
| `AllowlistCompliance` | Pluggable participation gate. Swapping it is how the protocol adapts to a jurisdiction without touching market logic. |

### Tests

```bash
cd contracts && forge test
```

23 passing — 7 market unit, 9 vault integration, 7 stateful invariant.

The invariant suite holds `escrow ≥ floor` and conservation of liabilities across randomised bid, contest, withdraw, decay, and settlement sequences. The integration suite exists because a mocked vault hid two real bugs: settlement could not deliver collateral the market never escrowed, and underwriters were receiving the borrower's *unspent* premium on default — unearned income at the exact moment the commitment ends, which rewards pushing borrowers into default.

## Deploy

```bash
cd contracts
export BOTCHAIN_TESTNET_RPC_URL=...   # testnet first
export STABLE_TOKEN=0x...
forge script script/Deploy.s.sol:Deploy --rpc-url botchain_testnet --broadcast

# then mainnet
export BOTCHAIN_RPC_URL=...
forge script script/Deploy.s.sol:Deploy --rpc-url botchain --broadcast --verify
```

Then set the printed addresses in `web/.env` (see `web/.env.example`) and the frontend reads chain state instead of recorded terms. The UI renders fully either way — deployment turns the controls live, it never decides whether content is visible.

### Deployed addresses

| Network | Contract | Address |
|---|---|---|
| BOT Chain testnet | — | pending |
| BOT Chain mainnet (677) | — | pending |

## Web

```bash
cd web && npm install && npm run dev
```

## Status

Contracts complete and tested. Frontend building. Agents next. Testnet deployment ahead of mainnet.

## Licence

BUSL-1.1 for contracts.
