## What this changes, and why

<!-- The reasoning, not a list of files. The diff already lists the files. -->

## How it was verified

<!-- Commands run and what they printed. "Tests pass" is not verification. -->

- [ ] `forge test` passes
- [ ] `forge test --profile ci` passes (only if `contracts/src` changed)
- [ ] `forge snapshot --check ...` passes, or the snapshot is regenerated and the move is explained
- [ ] `npm run typecheck && npm run lint && npm test` passes in `frontend/`
- [ ] `bun run typecheck && bun test` passes in `agent/`

## If this touches `contracts/src`

- [ ] There is a test that fails before this change and passes after
- [ ] Rounding direction is explicit at every new fixed-point call site
- [ ] No new privileged function, or the pull request explains who holds the key

## If this touches nothing but docs

Say so and delete the rest.
