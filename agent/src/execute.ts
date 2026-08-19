import {formatUnits} from "viem";
import {readFileSync} from "node:fs";

import {CONTRACTS, DECIMALS, erc20Abi, marketAbi, publicClient, walletFor} from "./chain";
import type {Proposal} from "./types";

/**
 * EXECUTE. Submits proposals a person has approved.
 *
 * Refuses to run without `--yes`, because the whole reason this is a separate
 * command is that the approval should be impossible to give by accident.
 *
 * Every proposal is re-checked against live chain state first. A proposal is a
 * statement about a book at a moment, and books move: the slot may have been
 * contested since, the floor may have risen past what this agent would pay, or
 * the agent may already hold it. Submitting blind would turn a stale opinion
 * into a revert, and a revert in a log reads like a decision rather than a
 * race.
 *
 *   bun run execute -- --yes
 *   bun run execute -- --yes --agent conservative
 */

const IN = process.env.PROPOSALS_FILE ?? "proposals.json";
const YES = process.argv.includes("--yes");
const ONLY = (() => {
  const i = process.argv.indexOf("--agent");
  return i !== -1 ? process.argv[i + 1] : undefined;
})();

const fmt = (v: bigint) =>
  Number(formatUnits(v, DECIMALS)).toLocaleString("en-US", {maximumFractionDigits: 2});

async function main() {
  const file = JSON.parse(readFileSync(IN, "utf8")) as {proposals: Proposal[]};
  let queue = file.proposals ?? [];
  if (ONLY) queue = queue.filter((p) => p.agent === ONLY);

  if (queue.length === 0) {
    console.log(`nothing to execute in ${IN}${ONLY ? ` for agent "${ONLY}"` : ""}`);
    return;
  }

  console.log(`${queue.length} approved proposal(s) from ${IN}\n`);
  for (const p of queue) {
    console.log(
      `  ${p.book.padEnd(13)} asset #${p.assetId}  ${fmt(BigInt(p.floor))} USDT  ` +
        `grade ${p.grade}  [${p.source}]`,
    );
    console.log(`  ${" ".repeat(15)}${p.rationale}`);
  }

  if (!YES) {
    console.log("\nDry run. Nothing was submitted.");
    console.log("Re-run with --yes to escrow capital behind these numbers.");
    return;
  }

  console.log("");

  for (const p of queue) {
    const {account, client} = walletFor(
      process.env[`AGENT_${p.agent.toUpperCase()}_KEY`] as `0x${string}`,
    );
    const assetId = BigInt(p.assetId);
    const floor = BigInt(p.floor);
    const tag = `  ${p.book.padEnd(13)}`;

    // --- revalidate: the book may have moved since this was proposed
    const slot = await publicClient.readContract({
      abi: marketAbi,
      address: CONTRACTS.market,
      functionName: "slots",
      args: [assetId],
    });

    if (!slot.open) {
      console.log(`${tag} SKIP     slot #${assetId} is no longer open`);
      continue;
    }
    if (slot.underwriter.toLowerCase() === account.address.toLowerCase()) {
      console.log(`${tag} SKIP     already holds #${assetId}`);
      continue;
    }
    if (slot.floor >= floor && slot.underwriter !== "0x0000000000000000000000000000000000000000") {
      console.log(
        `${tag} STALE    #${assetId} now stands at ${fmt(slot.floor)}, ` +
          `above the proposed ${fmt(floor)} - re-run propose`,
      );
      continue;
    }

    const balance = (await publicClient.readContract({
      abi: erc20Abi,
      address: CONTRACTS.stable,
      functionName: "balanceOf",
      args: [account.address],
    })) as bigint;

    if (balance < floor) {
      console.log(
        `${tag} UNFUNDED holds ${fmt(balance)}, needs ${fmt(floor)} - run \`bun run fund:send\``,
      );
      continue;
    }

    const allowance = (await publicClient.readContract({
      abi: erc20Abi,
      address: CONTRACTS.stable,
      functionName: "allowance",
      args: [account.address, CONTRACTS.market],
    })) as bigint;

    if (allowance < floor) {
      const approval = await client.writeContract({
        abi: erc20Abi,
        address: CONTRACTS.stable,
        functionName: "approve",
        args: [CONTRACTS.market, floor * 4n],
      });
      // The bid pulls escrow, so the allowance must be MINED, not merely sent.
      await publicClient.waitForTransactionReceipt({hash: approval});
    }

    const hash = await client.writeContract({
      abi: marketAbi,
      address: CONTRACTS.market,
      functionName: "bid",
      args: [assetId, floor, BigInt(p.premiumRate)],
    });
    await publicClient.waitForTransactionReceipt({hash});

    console.log(`${tag} BID      #${assetId} at ${fmt(floor)} · ${p.reason}  ${hash}`);
  }

  console.log("\ndone.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
