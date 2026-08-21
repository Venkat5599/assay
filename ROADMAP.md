# Roadmap

What LADING does next, and what has to be true before each step is honest to
take. Dates are targets, not commitments; the ordering is the commitment.

The through-line: every stage removes one reason a carrier could not use this
with real money. Nothing here is a feature list — each item closes a specific
gap named in the README's Status section or in `docs/PRODUCTION.md`.

## Now — mainnet is deployed, the book is not seeded

All five contracts are live and immutable on BOT Chain mainnet (677), and the
core three are verified on Blockscout. The interface reads mainnet by default
and supports wallet interaction against it.

What is missing is capital. LADING settles in bridged USDT — an asset it does
not issue, with no faucet — so the book stays empty until USDT is bridged to
the deployment. `script/SeedMainnet.s.sol` refuses to run against a balance it
does not have, which is deliberate: a seed script that pretends to escrow what
it cannot hold is how a demo becomes a lie.

- [ ] Bridge settlement capital and run the first mainnet origination
- [ ] Grade that load with a live agent and commit the bid from an agent EOA
- [ ] First mainnet borrow, repayment, and slot close

## Next — the loop runs unattended where it is safe to

The agents already run unattended on testnet and refuse to on mainnet without
an explicit, loud override. That asymmetry is correct and stays.

- [ ] Agents withdraw a position that has become unprofitable. Today an agent
      will take a slot and will not leave one, which is half a strategy.
- [ ] Commit the rationale hash on chain beside the bid. The grade and its
      reasoning live in `proposals.json` today; the chain holds only the price.
      Committing a hash makes the audit trail verifiable without putting a
      model's prose on chain.
- [ ] Second underwriter operator, not run by us, contesting the same slots.
      Price discovery with one participant is not price discovery.

## Then — the parts that need someone other than us

- [ ] External audit of `contracts/src`. The suite holds 82 tests including
      stateful invariants; that is a floor, not an assurance, and SECURITY.md
      says so.
- [ ] A real carrier and a real shipper, with a real bill of lading and a real
      assignment notice. Everything before this point is mechanism; this is the
      first point at which it is a product.
- [ ] Duplicate-financing detection beyond `docHash` uniqueness within LADING.
      The same invoice pledged on another protocol is invisible to us today.
- [ ] A jurisdictional compliance module to replace the allowlist. The gate is
      pluggable precisely so this can change without touching market logic.

## Why BOT Chain

Block times near 0.75s make per-block floor decay a usable mechanism rather
than a rounding error — the decay rate in `FirmBidMarket` is calibrated to this
chain, and on a twelve-second chain the same curve is far coarser. Settlement
in one block is a claim that depends on the block being cheap and fast.

The chain's stated direction is AI and RWA. LADING is both, and not by
adaptation: the underwriters are agents that hold their own keys and escrow
their own capital, and the collateral is a freight receivable. It was built for
this ecosystem rather than ported into it.

## How this keeps producing on-chain activity

Every financed load is a sequence of transactions rather than one: register,
open, bid, contest, draw, accrue, repay or settle. A contested slot generates
activity for as long as it is contested, because a bid that is never restated
decays until someone restates it. The mechanism's baseline is motion, not a
one-time deployment.

Maintenance is ordinary and continuous: CI runs the contract suite, a fuzz and
invariant sweep, Slither, gitleaks, a dependency audit and a gas snapshot on
every change, and `CONTRIBUTING.md` states the bar a change to `contracts/src`
has to clear.
