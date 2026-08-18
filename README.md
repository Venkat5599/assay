# Assay

**Proven computation for real-world assets. No trust — a sealed receipt.**

Assay is a verifiable valuation engine for tokenized real-world assets (RWA) on BOT Chain. It forces the model that prices an asset to prove its math inside a sealed enclave, commits the inputs it used to the chain permanently, and lets the pool settle only on what was actually proven — never on a signed promise.

## The problem

Put money into a tokenized RWA pool (treasury, private credit, real estate) and you trust the issuer's reported NAV and yield. There is no way to verify the number before it collapses. Assay makes the number provable: a pinned model, on pinned inputs, producing a pinned output, verified on-chain.

## The proof chain

1. **Commit inputs** — the full dataset the model prices (holdings, market data, accruals) is written to a BOT Chain blob (EIP-4844, persisted on the execution layer, retrievable via `eth_getBlobSidecarByTxHash`).
2. **Compute in a sealed enclave** — the valuation model runs inside a TEE (iExec Nox). The enclave reads the blob-committed inputs and computes NAV / yield.
3. **Prove the computation** — the enclave emits a hardware attestation quote binding `(blob hash, model hash, output)`.
4. **Verify on-chain** — a verifier contract checks the quote and the blob commitment before accepting the output as official.
5. **Settle gated by proof** — distribution never exceeds verified yield; redemption never exceeds verified NAV; mark-downs fire only on a verified recompute.
6. **Gasless loop** — the EOA Paymaster sponsors attestation and settlement gas, so neither the operator nor the holder holds BOT to run the loop.

The output is not "an AI says X." It is: a pinned model, on pinned inputs, provably produced X, and the chain settled on that.

## Why BOT Chain

- **Blob data lives on the execution layer** — unlike Ethereum, sidecars are not pruned, so committed inputs stay auditable forever.
- **EOA Paymaster** — gasless sponsorship without EIP-4337 or smart-contract wallets, so the prove-and-settle loop runs continuously at near-zero cost.
- **Sub-second finality** — the verify → settle path is near-instant.

## Status

**README only.** No code, no deployments. Contracts, enclave agent, verifier, and dashboard land in sequence, each verified live before the next. Nothing in this repo is or will be mock data, a simulated loop, or a hardcoded address.

## Planned layout

```
contracts/   Foundry — ValuationOracle, Verifier, SettlementPool (+ tests)
enclave/     iExec Nox — valuation model + attestation generation
agent/       orchestrator — blob commit → compute → verify → settle
web/         dashboard — prove-a-NAV flow, live receipt viewer
scripts/     mainnet deploy (chain 677), E2E loop
```

## Judging checklist — BOT Chain Builder Challenge #2

Weights: Product Completion 30 · BOT Chain Mainnet Integration 25 · Innovation 20 · UX 15 · Technical 10.

- [ ] BOT Chain Mainnet deployment (chain 677), contracts verified on scan.botchain.ai
- [ ] Blob-committed input proofs (native blob DA, execution-layer persistence)
- [ ] TEE attestation quotes verified on-chain (enclave → verifier contract)
- [ ] EOA Paymaster gasless settlement (no BOT held by operator or holder)
- [ ] Complete loop: commit → compute → prove → settle → redeem
- [ ] Public site + online demo, wallet-connected
- [ ] GitHub repository (this repo)
- [ ] Demo video
- [ ] Original development — no resubmission of prior entries
