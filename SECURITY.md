# Security

LADING custodies escrowed capital in immutable contracts. There is no proxy and
no upgrade key, which means a deployed bug cannot be patched in place — it can
only be contained by draining and redeploying. Please treat that as the reason
to report rather than to publish.

## Status

**Unaudited.** No third-party audit has been performed. The contracts under
`contracts/src` carry a 82-test suite including stateful invariants, and that is
a floor, not an assurance. Do not commit capital you are unwilling to lose.

## Reporting a vulnerability

Report privately through GitHub's
[private vulnerability reporting](https://github.com/Venkat5599/assay/security/advisories/new).
It reaches the maintainers without creating a public record.

Please do not open a public issue, pull request, or social post for anything
that could move or freeze escrowed funds.

Include what you have: the contract and function, the conditions the exploit
needs, and a Foundry test that demonstrates it if you have written one. A
failing test against `contracts/` is the fastest possible path to a fix.

Expect an acknowledgement within 72 hours and an assessment within seven days.
If you do not hear back, assume the message was lost rather than ignored, and
send it again.

## Scope

In scope, in rough order of severity:

- Anything that lets escrow leave `FirmBidMarket` other than through settlement,
  withdrawal by its owner, or a contest that replaces it.
- Anything that lets a borrower draw beyond `F x (1 - haircut)`, or that lets a
  default go uncallable when its trigger has fired.
- Accounting that lets a lender's claim on `LoanVault` exceed the assets behind
  it, or that routes settlement surplus anywhere but the borrower.
- Registering a receivable whose document hash is already pledged.
- Compliance bypass: acting in a role the gate did not grant.

Out of scope: the price a model assigns to a load, gas costs, missing rate
limits on public read paths, and anything requiring a compromised private key.

## Known and accepted

Stated plainly so nobody spends time reporting them as findings:

- Contracts are immutable with no pause. This is deliberate; on a protocol that
  custodies escrow, an upgrade key is the real collateral.
- The owner of `AllowlistCompliance` can open participation to everyone
  (`setOpenAccess`) and can grant any role. The gate is trusted by construction.
- The owner of `AssetRegistry` can swap the compliance module.
- `docHash` uniqueness is enforced within LADING only. The same invoice pledged
  on another protocol is not visible here.
- Agent underwriters run off-chain and their grades are not committed on chain.
  `docs/PRODUCTION.md` covers what that becomes when it holds other people's
  money.
