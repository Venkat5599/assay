import {formatEther, formatUnits, parseEther, parseUnits} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {chain, CONTRACTS, DECIMALS, erc20Abi, publicClient, walletFor} from "./chain";
import {MANDATES} from "./mandates";

/**
 * Stakes the agent underwriters.
 *
 * `package.json` has advertised this script for the whole life of the project
 * and the file did not exist. It matters more on mainnet than it did on
 * testnet: there is no faucet here, the settlement asset is bridged USDT, and
 * an agent with no balance does not fail loudly - it grades a load, prices it,
 * submits a bid, and reverts on the escrow pull, which reads in the logs like a
 * pricing decision rather than an empty wallet.
 *
 * So this checks first and moves only what is missing. Idempotent by design:
 * run it as often as you like, it tops up rather than re-sends.
 *
 *   bun run src/fund.ts            report balances, move nothing
 *   bun run src/fund.ts --send     top each agent up to target
 */

const SEND = process.argv.includes("--send");

/** Enough BOT for a long run of approve+bid pairs at 20 gwei. */
const GAS_TARGET = parseEther(process.env.AGENT_GAS_TARGET ?? "0.05");

/** Escrow capital per agent, in whole settlement units. */
const CAPITAL_TARGET = parseUnits(process.env.AGENT_CAPITAL_TARGET ?? "5000", DECIMALS);

function agents() {
  const out: {name: string; address: `0x${string}`}[] = [];
  for (const [slug, mandate] of Object.entries(MANDATES)) {
    const key = process.env[`AGENT_${slug.toUpperCase()}_KEY`] as `0x${string}` | undefined;
    if (!key) {
      console.warn(`  ${mandate.name.padEnd(13)} no key set - skipped`);
      continue;
    }
    out.push({name: mandate.name, address: privateKeyToAccount(key).address});
  }
  return out;
}

async function main() {
  const funderKey = process.env.FUNDER_KEY as `0x${string}` | undefined;
  const roster = agents();
  if (roster.length === 0) throw new Error("no agent keys found - set AGENT_CONSERVATIVE_KEY etc.");

  console.log(`chain ${chain.id} · settlement ${CONTRACTS.stable} · ${DECIMALS} decimals\n`);

  const rows = await Promise.all(
    roster.map(async (a) => {
      const gas = await publicClient.getBalance({address: a.address});
      const capital = (await publicClient.readContract({
        abi: erc20Abi,
        address: CONTRACTS.stable,
        functionName: "balanceOf",
        args: [a.address],
      })) as bigint;
      return {...a, gas, capital};
    }),
  );

  for (const r of rows) {
    const gasShort = GAS_TARGET > r.gas ? GAS_TARGET - r.gas : 0n;
    const capShort = CAPITAL_TARGET > r.capital ? CAPITAL_TARGET - r.capital : 0n;
    console.log(
      `  ${r.name.padEnd(13)} ${r.address}\n` +
        `    gas     ${formatEther(r.gas).padStart(12)} BOT` +
        (gasShort ? `  short ${formatEther(gasShort)}` : "  ok") +
        `\n    capital ${formatUnits(r.capital, DECIMALS).padStart(12)} USDT` +
        (capShort ? `  short ${formatUnits(capShort, DECIMALS)}` : "  ok"),
    );
  }

  if (!SEND) {
    console.log("\nreport only. re-run with --send to top up.");
    return;
  }
  if (!funderKey) throw new Error("FUNDER_KEY is required to send");

  const {account, client} = walletFor(funderKey);
  console.log(`\nfunding from ${account.address}`);

  for (const r of rows) {
    const gasShort = GAS_TARGET > r.gas ? GAS_TARGET - r.gas : 0n;
    if (gasShort > 0n) {
      const hash = await client.sendTransaction({to: r.address, value: gasShort});
      await publicClient.waitForTransactionReceipt({hash});
      console.log(`  ${r.name.padEnd(13)} +${formatEther(gasShort)} BOT   ${hash}`);
    }

    const capShort = CAPITAL_TARGET > r.capital ? CAPITAL_TARGET - r.capital : 0n;
    if (capShort > 0n) {
      const hash = await client.writeContract({
        abi: erc20Abi,
        address: CONTRACTS.stable,
        functionName: "transfer",
        args: [r.address, capShort],
      });
      await publicClient.waitForTransactionReceipt({hash});
      console.log(
        `  ${r.name.padEnd(13)} +${formatUnits(capShort, DECIMALS)} USDT  ${hash}`,
      );
    }
  }
  console.log("\ndone.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
