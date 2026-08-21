# Seeding mainnet

The one step between "contracts deployed" and "a complete business loop on
mainnet". Everything here is paste-ready; the only thing missing is settlement
capital.

## What it actually costs

`SeedMainnet.s.sol` checks one thing before it broadcasts:

```solidity
require(held >= c.premium + c.pool, "insufficient settlement balance");
```

`FACE` is recorded metadata and costs nothing. `PREMIUM` and `POOL` are real
transfers. The other real cost is the **bid**, because an underwriter escrows
the floor in full — and the floor is chosen by the underwriter, so the whole
loop scales down together.

The script's defaults describe a realistic invoice, not a required one:

| | Default | Minimum useful demo |
|---|---|---|
| `FACE` | 18,400 | 100 |
| `PREMIUM` | 400 | 2 |
| `POOL` | 5,000 | 40 |
| Bid floor (separate tx) | ~15,000 | 80 |
| **USDT needed** | **~20,400** | **~122** |

Tighter still — `FACE=25`, `PREMIUM=1`, `POOL=10`, floor `20` — runs the entire
loop for about **31 USDT**. The ratios stay honest at any scale: floor sits
under face, `maxLoan = floor x 0.8`.

Bridge at https://bridge.botchain.ai/ to the deployer address.

## Run it

```bash
cd contracts
set -a && . ./.env.mainnet && set +a

export ASSET_REGISTRY=0xe33eE752dbb1724f6939A105cecFF2714F684172
export FIRM_BID_MARKET=0x83f8C719854a561b38E85484568E59CD34d81525
export LOAN_VAULT=0xCc18DFC9a339d9D1298dbD90617121Ce319D358E
export STABLE_TOKEN=0xaBabc7Ddc03e501d190C676BF3d92ef0e6e87a3C
export COUNTERPARTY_REGISTRY=0xE07f9907fbA27659e1ED8993A2eA8FE343a91f2F

export OBLIGOR=0x000000000000000000000000000000000000dEaD
export OBLIGOR_NAME="Ridgeline Produce Distribution"
export OBLIGOR_JURISDICTION=US
export DOC_REF="lading/mainnet/bol/1"

export FACE=100
export PREMIUM=2
export POOL=40
export TERM_DAYS=90

forge script script/SeedMainnet.s.sol:SeedMainnet \
  --rpc-url botchain --private-key $PRIVATE_KEY --legacy --broadcast
```

`--legacy` matters: BOT Chain is not in Foundry's known-chain list, so the
1559 fee path has nothing to read.

The script stops after opening the slot. It does **not** bid, and that is
deliberate — the deployer bidding against itself to decorate the book is the
exact fiction this protocol exists to remove.

## Then price it from an agent

```bash
cd agent
# point .env at mainnet: RPC_URL=https://rpc.botchain.ai, CHAIN_ID=677,
# the five addresses above, STABLE_DECIMALS=6
bun run fund              # report agent gas and capital, move nothing
bun run fund:send         # top the agents up from FUNDER_KEY
bun run propose           # grade the book, write proposals.json, touch nothing
bun run execute -- --yes  # escrow capital behind the approved proposals
```

Each agent needs the floor it intends to bid, plus gas. At `FACE=100` a floor
near 80 means one funded agent is enough to make the slot priced; two make it
contested.

`bun run start` refuses on mainnet by design. A model grading real money with
nobody reading the grade is not a demo.

## Verify it worked

```bash
cast call $ASSET_REGISTRY "exists(uint256)(bool)" 1 --rpc-url https://rpc.botchain.ai
cast call $FIRM_BID_MARKET "currentFloor(uint256)(uint256)" 1 --rpc-url https://rpc.botchain.ai
cast call $FIRM_BID_MARKET "maxBorrow(uint256)(uint256)" 1 --rpc-url https://rpc.botchain.ai
```

Figures are in six decimals. `100000000` is 100 USDT, not 100 wei of anything.
