import {formatUnits, parseAbiItem} from "viem";

import {
  CONTRACTS,
  DECIMALS,
  erc20Abi,
  marketAbi,
  publicClient,
  registryAbi,
  vaultAbi,
  walletFor,
} from "./chain";
import {contest, type Slot} from "./contest";
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
const ZERO = "0x0000000000000000000000000000000000000000";

const REGISTERED = parseAbiItem(
  "event Registered(uint256 indexed id, address indexed owner, bytes32 indexed docHash, uint128 faceValue)",
);

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

/**
 * Discover assets from `Registered` logs.
 *
 * This used to walk ids 1..12 and stop at the first that did not exist. Two
 * ways to go blind: a book of more than twelve, or a single gap in the id
 * sequence hiding everything behind it. The registry emits an event for exactly
 * this, so ask the chain what exists rather than guessing a range.
 */
async function openSlots(): Promise<Load[]> {
  const logs = await publicClient.getLogs({
    address: CONTRACTS.registry,
    event: REGISTERED,
    fromBlock: 0n,
    toBlock: "latest",
  });

  const found: Load[] = [];
  for (const log of logs) {
    const id = log.args.id!;
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
      const tag = `  ${agent.mandate.name.padEnd(13)}`;

      const slot = (await publicClient.readContract({
        abi: marketAbi,
        address: CONTRACTS.market,
        functionName: "slots",
        args: [load.assetId],
      })) as unknown as Slot;

      const mine = slot.underwriter.toLowerCase() === account.address.toLowerCase();

      // ---- holding a position: decide whether it is still worth holding
      if (mine) {
        const debt = (await publicClient.readContract({
          abi: vaultAbi,
          address: CONTRACTS.vault,
          functionName: "outstanding",
          args: [load.assetId],
        })) as bigint;

        // An exhausted reserve means the commitment has stopped being paid for.
        // Capital is still locked against a purchase obligation earning nothing,
        // so the correct move is to release it - but never out from under a live
        // loan, which the contract refuses anyway.
        if (slot.premiumReserve === 0n && debt === 0n) {
          const hash = await client.writeContract({
            abi: marketAbi,
            address: CONTRACTS.market,
            functionName: "withdrawBid",
            args: [load.assetId],
          });
          await publicClient.waitForTransactionReceipt({hash});
          console.log(`${tag} EXITS    reserve empty, no debt - escrow released  ${hash}`);
          continue;
        }

        console.log(
          `${tag} HOLDS    ${fmt(slot.floor)}` +
            (debt > 0n ? ` · ${fmt(debt)} drawn against it` : " · undrawn") +
            ` · reserve ${fmt(slot.premiumReserve)}`,
        );
        continue;
      }

      // ---- not holding: grade, price, and decide whether to take the slot
      const assessment = await assess(load, agent.mandate);
      const quote = price(load, agent.mandate, assessment);
      const graded = `${tag} ${assessment.grade.padEnd(6)}`;

      if (quote.abstain) {
        console.log(`${graded} ABSTAIN  ${assessment.rationale}`);
        continue;
      }

      let floor = quote.floor;
      let rate = quote.premiumRate;
      let why = "opens the book";

      if (slot.underwriter !== ZERO) {
        const move = contest(quote, slot, minImprovement as bigint);
        if (!move) {
          console.log(
            `${graded} PASS     ${fmt(quote.floor)} @ ${rate} cannot better ` +
              `${fmt(slot.floor)} @ ${slot.premiumRate}`,
          );
          continue;
        }
        floor = move.floor;
        rate = move.rate;
        why = move.why;
      }

      // Escrow is pulled on bid, so the allowance must exist and be MINED first.
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
        await publicClient.waitForTransactionReceipt({hash: approval});
      }

      const hash = await client.writeContract({
        abi: marketAbi,
        address: CONTRACTS.market,
        functionName: "bid",
        args: [load.assetId, floor, rate],
      });
      await publicClient.waitForTransactionReceipt({hash});

      console.log(`${graded} BID      ${fmt(floor)} · ${why}  [${assessment.source}] ${hash}`);
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
    `\nmarket:   ${CONTRACTS.market}`,
    `\nsettles:  ${CONTRACTS.stable} (${DECIMALS} decimals)\n`,
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
