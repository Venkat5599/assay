# Verifying LADING on BOT Chain mainnet

BOT Chain's explorer runs **Blockscout**, which verifies without credentials.
The `BOTSCAN_API_KEY` this repo used to ask for never needed to exist, and
`foundry.toml` now points at the Blockscout endpoint directly.

## Status

All five mainnet contracts are verified.

| Contract | Address | Verified |
|---|---|---|
| `AllowlistCompliance` | `0xacadeD6bA05362004A28D64938c6D794536dC3E7` | ✅ |
| `CounterpartyRegistry` | `0xE07f9907fbA27659e1ED8993A2eA8FE343a91f2F` | ✅ |
| `AssetRegistry` | `0xe33eE752dbb1724f6939A105cecFF2714F684172` | ✅ |
| `FirmBidMarket` | `0x83f8C719854a561b38E85484568E59CD34d81525` | ✅ |
| `LoanVault` | `0xCc18DFC9a339d9D1298dbD90617121Ce319D358E` | ✅ |

## What was actually blocking it

Cloudflare sits in front of `scan.botchain.ai` and returns 403 on the
verification POST. The earlier diagnosis here - payload size, and a browser
session getting through where the CLI did not - was wrong on both counts.

Measured against the live WAF:

| Payload | Result |
|---|---|
| 96 KB of random base64 | 200 |
| First 36 KB of `LoanVault.json` | 200 |
| First 48 KB of `LoanVault.json` | 403 |
| `AssetRegistry.json`, 119 KB, OpenZeppelin comments stripped | 200 |

Size is not the variable. Random data sails through at twice the size that
real sources are refused at, and a 119 KB payload passes once comments are
removed. The rule is scoring **comment text in the OpenZeppelin sources** -
NatSpec full of angle-bracketed URLs and markup-shaped punctuation reads to a
generic WAF ruleset like an injection attempt. Submitting from a real Chrome
session fails identically, because the payload is what is being judged, not
the client.

## The `.lean.json` payloads

`<Name>.lean.json` is the same standard JSON input with comments stripped
**from `lib/` only**. Every LADING source under `src/` keeps its full NatSpec
and every explanatory comment, which is what is published on the explorer.

Comments do not affect compiled output, and `bytecode_hash = "none"` means no
metadata hash is embedded either, so the lean payload compiles to bytecode
identical to the deployment. Blockscout compares bytecode - it accepted all
three on the first attempt, which is that equality demonstrated rather than
asserted.

The full-comment `<Name>.json` files are kept beside them. Use those if the
WAF rule is ever relaxed; they are the preferred payload and are what should
be submitted when it works.

## Submitting

One at a time. Constructor arguments are ABI-encoded, no `0x` needed by the
form but accepted by the API.

```bash
# LoanVault - (owner, usdt, registry, compliance)
curl -X POST \
  "https://scan.botchain.ai/api/v2/smart-contracts/0xCc18DFC9a339d9D1298dbD90617121Ce319D358E/verification/via/standard-input" \
  -F "compiler_version=v0.8.28+commit.7893614a" \
  -F "license_type=bsl_1_1" \
  -F "autodetect_constructor_args=false" \
  -F "constructor_args=0x$(cast abi-encode 'c(address,address,address,address)' \
      0x20FCBBD388e2a1660E727697e0EF43eB4d9d3D24 \
      0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C \
      0xe33eE752dbb1724f6939A105cecFF2714F684172 \
      0xacadeD6bA05362004A28D64938c6D794536dC3E7 | sed 's/^0x//')" \
  -F "files[0]=@verification/LoanVault.lean.json;type=application/json"
```

`FirmBidMarket` takes the same four arguments. `AssetRegistry` takes
`(owner, compliance)`.

Confirm with:

```bash
curl -s https://scan.botchain.ai/api/v2/smart-contracts/<address> \
  | python -c "import sys,json;print(json.load(sys.stdin)['is_verified'])"
```

## Regenerating

```bash
forge verify-contract <address> <path:Name> --chain-id 677 \
  --show-standard-json-input > verification/<Name>.json
```

Then regenerate the lean variant by stripping comments from every `lib/`
source in that file, leaving `src/` untouched.
