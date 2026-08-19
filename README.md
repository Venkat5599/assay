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

The grade and its rationale stay in the agent process and in its logs; what reaches the chain is the
number the kernel produced and the capital escrowed behind it. Committing the rationale itself is a
change to `bid`, and it is not made yet - so the UI says where the reasoning lives rather than
implying the chain holds it.

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

35 passing — 7 market unit, 12 vault integration, 8 stateful invariant, 8 counterparty. The agent's
pricing kernel has its own suite: `cd agent && bun test`.

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

**BOT Chain mainnet (chain 677)** — live, explorer [scan.botchain.ai](https://scan.botchain.ai)

| Contract | Address |
|---|---|
| `AssetRegistry` | [`0xe33eE752dbb1724f6939A105cecFF2714F684172`](https://scan.botchain.ai/address/0xe33eE752dbb1724f6939A105cecFF2714F684172) |
| `FirmBidMarket` | [`0x83f8C719854a561b38E85484568E59CD34d81525`](https://scan.botchain.ai/address/0x83f8C719854a561b38E85484568E59CD34d81525) |
| `LoanVault` | [`0xCc18DFC9a339d9D1298dbD90617121Ce319D358E`](https://scan.botchain.ai/address/0xCc18DFC9a339d9D1298dbD90617121Ce319D358E) |
| `AllowlistCompliance` | [`0xacadeD6bA05362004A28D64938c6D794536dC3E7`](https://scan.botchain.ai/address/0xacadeD6bA05362004A28D64938c6D794536dC3E7) |

**Settlement asset:** bridged USDT, [`0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C`](https://scan.botchain.ai/address/0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C) — **six decimals, not eighteen.**

LADING settles in an asset it does not issue. There is no faucet on mainnet and nothing here is
mintable, which is the honest version of an RWA protocol and also the inconvenient one: capital has
to be bridged or bought before the loop can be exercised.

**BOT Chain testnet (chain 968)** — earlier build, explorer [scan.bohr.life](https://scan.bohr.life)

| Contract | Address |
|---|---|
| `AssetRegistry` | [`0x376470D20e0F67588A9DD5aFCeeD9748Dc4F1CD2`](https://scan.bohr.life/address/0x376470D20e0F67588A9DD5aFCeeD9748Dc4F1CD2) |
| `FirmBidMarket` | [`0x6438EDAeebF482212fbcf5a681Be0b698f952F05`](https://scan.bohr.life/address/0x6438EDAeebF482212fbcf5a681Be0b698f952F05) |
| `LoanVault` | [`0x82570C2Aa5cCbE7F003A96931094b9d7590645D5`](https://scan.bohr.life/address/0x82570C2Aa5cCbE7F003A96931094b9d7590645D5) |
| `AllowlistCompliance` | [`0xEC6d05d9f71c120AD4E7178F06E9f5fFc4586503`](https://scan.bohr.life/address/0xEC6d05d9f71c120AD4E7178F06E9f5fFc4586503) |
| `TestStable` (tUSD) | [`0x43C6BB88dA4c5764de4F5b250D8cA4008c7c3549`](https://scan.bohr.life/address/0x43C6BB88dA4c5764de4F5b250D8cA4008c7c3549) |

The testnet deployment predates floor decay and settles in a token we mint, so it is kept as
history rather than as the live system.

## Agents

```bash
cd agent
cp .env.example .env      # addresses are prefilled for mainnet; add keys
bun install
bun test                  # the pricing kernel
bun run fund              # report agent gas and capital, move nothing
bun run fund:send         # top each agent up from FUNDER_KEY
bun run start             # continuous
```

Three underwriters with genuinely different books. Each holds its own EOA and escrows its own
capital, so a generous grade is paid for by whoever produced it. `Dockerfile` is there because a
sleeping agent is an underwriter who stopped answering the market mid-commitment.

## Web

```bash
cd web && npm install && npm run dev
```

## Parameters

Every number the protocol runs on, and where it comes from.

| Parameter | Value | Meaning |
|---|---|---|
| `haircutBps` | 2000 | `maxLoan = F x (1 - 20%)` |
| `minImprovementBps` | 25 | A contest must better the incumbent by 0.25%, so the slot cannot be churned with dust |
| `decayRatePerBlock` | 2.15e-8 RAY | An uncontested floor loses ~20% across a 90-day receivable on this 0.75s chain |
| `maxDecayRate` | 1e-6 RAY | Ceiling on the above: ~11% a day, so no setting can erase a floor before anyone reacts |
| `ratePerBlock` | 1e-9 RAY | Borrower interest, compounded by index |
| `gracePeriod` | 3 days | Past `dueDate` before maturity default can be called |

Decay is a protocol parameter, not a bid parameter, and that is deliberate. It is worth money to
the underwriter, who settles at the decayed floor, and costs the borrower headroom - so neither
party at the table is allowed to choose it. A contest resets the clock, so decay only ever bites a
bid nobody has restated.

## Status

Live on **BOT Chain mainnet (677)**, settling in bridged USDT. Frontend at
**https://lading-ten.vercel.app**, reading mainnet state. Contracts are immutable — there is no
proxy and no upgrade key, because on a protocol that custodies escrow the upgrade key is the real
collateral.

Known and deliberately not done: the agent rationale is not committed on chain (see above), agents
do not autonomously withdraw a position that has become unprofitable, and duplicate-financing
detection stops at document-hash uniqueness within LADING. `docs/PRODUCTION.md` maps what each of
those becomes when this holds other people's money.

## Licence

BUSL-1.1 for contracts.
