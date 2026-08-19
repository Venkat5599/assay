# Verifying LADING on BOT Chain mainnet

BOT Chain's explorer runs **Blockscout**, which verifies without credentials.
The `BOTSCAN_API_KEY` this repo used to ask for never needed to exist, and
`foundry.toml` now points at the Blockscout endpoint directly.

## Status

| Contract | Address | Verified |
|---|---|---|
| `AllowlistCompliance` | `0xacadeD6bA05362004A28D64938c6D794536dC3E7` | ✅ |
| `CounterpartyRegistry` | `0xE07f9907fbA27659e1ED8993A2eA8FE343a91f2F` | ✅ |
| `AssetRegistry` | `0xe33eE752dbb1724f6939A105cecFF2714F684172` | ⬜ |
| `FirmBidMarket` | `0x83f8C719854a561b38E85484568E59CD34d81525` | ⬜ |
| `LoanVault` | `0xCc18DFC9a339d9D1298dbD90617121Ce319D358E` | ⬜ |

## Why the last three are manual

The two that went through are small. The remaining three pull in OpenZeppelin's
ERC-721 and SafeERC20, so their standard-JSON payloads run to 60–120 KB, and
Cloudflare in front of `scan.botchain.ai` rejects POSTs of that size from an
address that has just made several — the block persists for a while afterwards
and is not header- or transport-dependent.

The verification itself is fine. Only the automated submission path is blocked,
and a browser session sails past the same WAF. Retrying `forge verify-contract`
from a different network, or after the block lapses, should also work.

## Doing it from the browser

Everything needed is in this directory. For each contract, open its address on
[scan.botchain.ai](https://scan.botchain.ai), choose **Verify & Publish**, then
**Solidity (Standard JSON Input)**, and fill in:

| Field | Value |
|---|---|
| Compiler | `v0.8.28+commit.7893614a` |
| Standard JSON | the matching `.json` file here |
| Optimization | enabled, **20000** runs |
| EVM version | `cancun` |
| License | BUSL-1.1 |

Constructor arguments, ABI-encoded:

**AssetRegistry** — `(owner, compliance)`

```
00000000000000000000000020fcbbd388e2a1660e727697e0ef43eb4d9d3d24
000000000000000000000000acaded6ba05362004a28d64938c6d794536dc3e7
```

**FirmBidMarket** — `(owner, usdt, registry, compliance)`

```
00000000000000000000000020fcbbd388e2a1660e727697e0ef43eb4d9d3d24
000000000000000000000000ababc7ddc03e501d190c676bf3d92ef0e6e87a3c
000000000000000000000000e33ee752dbb1724f6939a105cecff2714f684172
000000000000000000000000acaded6ba05362004a28d64938c6d794536dc3e7
```

**LoanVault** — `(owner, usdt, registry, compliance)`

```
00000000000000000000000020fcbbd388e2a1660e727697e0ef43eb4d9d3d24
000000000000000000000000ababc7ddc03e501d190c676bf3d92ef0e6e87a3c
000000000000000000000000e33ee752dbb1724f6939a105cecff2714f684172
000000000000000000000000acaded6ba05362004a28d64938c6d794536dc3e7
```

Paste each as one unbroken string with no `0x` prefix — the line breaks above
are only for reading.

## Retrying from the CLI

```bash
cd contracts
export BOTSCAN_API_KEY=blockscout        # placeholder; Blockscout ignores it

forge verify-contract 0xe33eE752dbb1724f6939A105cecFF2714F684172 \
  src/AssetRegistry.sol:AssetRegistry \
  --chain-id 677 \
  --verifier blockscout \
  --verifier-url https://scan.botchain.ai/api/ \
  --constructor-args $(cast abi-encode "c(address,address)" \
      0x20FCBBD388e2a1660E727697e0EF43eB4d9d3D24 \
      0xacadeD6bA05362004A28D64938c6D794536dC3E7) \
  --watch
```

Verify one at a time. Firing all of them in sequence is what triggered the
block in the first place.

## Regenerating these files

```bash
forge verify-contract <address> <path:Name> --chain-id 677 \
  --show-standard-json-input > verification/<Name>.json
```
