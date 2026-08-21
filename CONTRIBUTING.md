# Contributing

## Layout

```
contracts/   Foundry. The protocol. BUSL-1.1.
agent/       Bun + TypeScript. Autonomous underwriters. MIT.
frontend/    Next.js 16 + wagmi. Carrier flow and live auction. MIT.
docs/        PRD, shipping architecture, production architecture.
```

## Getting set up

```bash
git clone --recurse-submodules https://github.com/Venkat5599/assay
cd assay

cd contracts && forge build && forge test    # needs Foundry
cd ../agent  && bun install && bun test      # needs Bun
cd ../frontend && npm ci && npm test         # needs Node 22
```

If you cloned without `--recurse-submodules`, run `git submodule update --init
--recursive` — the contracts will not build without them.

## Before you open a pull request

Everything CI runs, you can run:

```bash
cd contracts
forge fmt --check
forge test
forge test --profile ci                      # the expensive fuzz and invariant sweep
forge snapshot --check --no-match-test "testFuzz|invariant" --no-match-contract "Invariants"

cd ../agent    && bun run typecheck && bun test
cd ../frontend && npm run typecheck && npm run lint && npm test && npm run build
```

A gas snapshot change is fine when it is intended — commit the regenerated
`.gas-snapshot` and say in the message why the number moved.

## What a change to `contracts/src` needs

This code holds escrowed capital and cannot be upgraded once deployed, so the
bar is higher here than elsewhere in the repository.

- **A test that fails before your change and passes after.** Not a test that
  exercises the new path; one that pins the behaviour you claim to have fixed.
- **An invariant, where the change touches accounting.** `test/invariant/` holds
  `escrow >= floor` and conservation of liabilities across randomised sequences.
  If your change creates a new thing that must always be true, say so there.
- **Explicit rounding.** Every fixed-point operation names its direction, and
  the direction must favour the protocol over the caller. `RayMath` gives you
  `rmul` (half up) and `rmulDown` (truncating) so the choice is visible at the
  call site.
- **No new privileged function** without a paragraph in the pull request
  explaining who holds the key and what happens when they lose it.

## Style

- Comments explain *why*, never *what*. The code already says what it does.
  If a line needs a comment to be understood, the line is the problem.
- Solidity is formatted by `forge fmt`. TypeScript follows the surrounding file;
  there is no formatter configured, so match what is already there.
- Commit messages: a short imperative summary, then prose explaining the
  reasoning. No bullet-point changelogs — the diff is the changelog.

## Security

Do not open a public issue or pull request for a vulnerability. See
[SECURITY.md](SECURITY.md).

## Licence

Contributions to `contracts/src` are under BUSL-1.1; everything else under MIT.
Opening a pull request means you are fine with that.
