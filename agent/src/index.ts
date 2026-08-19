import {formatUnits} from "viem";

import {CONTRACTS, DECIMALS, erc20Abi, marketAbi, publicClient, registryAbi, walletFor} from "./chain";
import {MANDATES} from "./mandates";
import {price} from "./pricing";
import {assess} from "./underwrite";
import type {Load, Mandate} from "./types";

/**
 * LADING agent underwriters.
 *
 * Each agent holds its own key, reads open slots, grades the load, prices it
 * from that grade, and escrows its own capital behind the number. Nothing here
 * is advisory - a bid moves real balance, and a bad grade is paid for by the
 * agent that produced it.
 *
 *   bun run src/index.ts          continuous
 *   bun run src/index.ts --once   one sweep, then exit
 */

const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 20_000);
const MAX_ASSET_SCAN = 12n;

interface Agent {
  key: `0x${string}`;
  mandate: Mandate;
}

function loadAgents(): Agent[] {
  const agents: Agent[] = [];
  for (const [slug, mandate] of Object.entries(MANDATES)) {
    const key = process.env[`AGENT_${slug.toUpperCase()}_KEY`] as `0x${string}` | undefined;
    if (key) agents.push({key, mandate});
  }
  if (agents.length === 0) {
    throw new Error("no agent keys found - set AGENT_CONSERVATIVE_KEY etc.");
  }
  return agents;
}

async function openSlots(): Promise<Load[]> {
  const found: Load[] = [];
  for (let id = 1n; id <= MAX_ASSET_SCAN; id++) {
    const exists = await publicClient.readContract({
      abi: registryAbi,
      address: CONTRACTS.registry,
      functionName: "exists",
      args: [id],
    });
    if (!exists) break;

    const slot = await publicClient.readContract({
      abi: marketAbi,
      address: CONTRACTS.market,
      functionName: "slots",
      args: [id],
    });
    if (!slot.open) continue;

    const r = await publicClient.readContract({
      abi: registryAbi,
      address: CONTRACTS.registry,
      functionName: "receivableOf",
      args: [id],
    });

    found.push({
      assetId: id,
      debtor: r.debtor,
      faceValue: r.faceValue,
      dueDate: r.dueDate,
      docHash: r.docHash,
    });
  }
  return found;
}

const fmt = (v: bigint) =>
  Number(formatUnits(v, DECIMALS)).toLocaleString("en-US", {maximumFractionDigits: 0});

async function sweep(agents: Agent[]) {
  const loads = await openSlots();
  if (loads.length === 0) {
    console.log("no open slots");
    return;
  }

  const minImprovement = await publicClient.readContract({
    abi: marketAbi,
    address: CONTRACTS.market,
    functionName: "minImprovementBps",
  });

  for (const load of loads) {
    console.log(
      `\nasset #${load.assetId} · face ${fmt(load.faceValue)} · doc ${load.docHash.slice(0, 10)}`,
    );

    for (const agent of agents) {
      const {account, client} = walletFor(agent.key);
      const assessment = await assess(load, agent.mandate);
      const quote = price(load, agent.mandate, assessment);

      const tag = `  ${agent.mandate.name.padEnd(13)} ${assessment.grade.padEnd(6)}`;

      if (quote.abstain) {
        console.log(`${tag} ABSTAIN  ${assessment.rationale}`);
        continue;
      }

      const slot = await publicClient.readContract({
        abi: marketAbi,
        address: CONTRACTS.market,
        functionName: "slots",
        args: [load.assetId],
      });

      // Contesting requires strictly better terms by at least the market's
      // anti-griefing margin. Below that threshold, holding is correct.
      if (slot.underwriter !== "0x0000000000000000000000000000000000000000") {
        if (slot.underwriter.toLowerCase() === account.address.toLowerCase()) {
          console.log(`${tag} HOLDS    incumbent at ${fmt(slot.floor)}`);
          continue;
        }
        const need = slot.floor + (slot.floor * minImprovement) / 10_000n;
        if (quote.floor < need) {
          console.log(
            `${tag} PASS     ${fmt(quote.floor)} does not beat ${fmt(slot.floor)} by enough`,
          );
          continue;
        }
      }

      // Escrow is pulled on bid, so the allowance must exist first. This is the
      // moment the agent puts its own capital behind its own judgement.
      const approval = await client.writeContract({
        abi: erc20Abi,
        address: CONTRACTS.stable,
        functionName: "approve",
        args: [CONTRACTS.market, quote.floor * 2n],
      });
      // The bid pulls escrow, so the allowance must be mined first - not merely
      // submitted. Skipping this receipt races the two transactions.
      await publicClient.waitForTransactionReceipt({hash: approval});

      const hash = await client.writeContract({
        abi: marketAbi,
        address: CONTRACTS.market,
        functionName: "bid",
        args: [load.assetId, quote.floor, quote.premiumRate],
      });
      await publicClient.waitForTransactionReceipt({hash});

      console.log(`${tag} BID      ${fmt(quote.floor)}  [${assessment.source}] ${hash}`);
      console.log(`  ${" ".repeat(20)}${assessment.rationale}`);
    }

    const floor = await publicClient.readContract({
      abi: marketAbi,
      address: CONTRACTS.market,
      functionName: "currentFloor",
      args: [load.assetId],
    });
    console.log(`  standing floor -> ${fmt(floor)}`);
  }
}

async function main() {
  const agents = loadAgents();
  console.log(
    `LADING agents: ${agents.map((a) => a.mandate.name).join(", ")}`,
    `\njudgment: ${process.env.ANTHROPIC_API_KEY ? "model" : "rubric"}`,
    `\nmarket:   ${CONTRACTS.market}\n`,
  );

  for (;;) {
    try {
      await sweep(agents);
    } catch (err) {
      console.error("sweep failed:", (err as Error).message);
    }
    if (ONCE) return;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
