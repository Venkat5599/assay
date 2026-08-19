import {CONTRACTS, DECIMALS, chain, erc20Abi, marketAbi, publicClient, vaultAbi, walletFor} from "./chain";
import * as cache from "./cache";
import {fmt, gradeCached, openSlots} from "./book";
import {contest, type Slot} from "./contest";
import {MANDATES} from "./mandates";
import {autonomyFor} from "./policy";
import {price} from "./pricing";
import {MODEL} from "./underwrite";
import type {Mandate} from "./types";

/**
 * THE UNATTENDED LOOP.
 *
 * Agents watch the book, grade what appears, price the grade, and escrow their
 * own capital behind it - no human in the path. This is the underwriter the
 * design describes: an economic actor that bears its own losses, not an
 * assistant that drafts a suggestion.
 *
 * It refuses to run where the money is real. `policy.ts` draws that line from
 * the chain id rather than from a setting someone forgot to flip, so the same
 * binary is autonomous on testnet and a proposal tool on mainnet.
 *
 *   bun run start          watch and act    (testnet)
 *   bun run start --once   one sweep, exit
 */

const ONCE = process.argv.includes("--once");
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 20_000);
const ZERO = "0x0000000000000000000000000000000000000000";

interface Agent {
  slug: string;
  key: `0x${string}`;
  mandate: Mandate;
}

function loadAgents(): Agent[] {
  const agents: Agent[] = [];
  for (const [slug, mandate] of Object.entries(MANDATES)) {
    const key = process.env[`AGENT_${slug.toUpperCase()}_KEY`] as `0x${string}` | undefined;
    if (key) agents.push({slug, key, mandate});
  }
  if (agents.length === 0) {
    throw new Error("no agent keys found - set AGENT_CONSERVATIVE_KEY etc.");
  }
  return agents;
}

async function sweep(agents: Agent[]) {
  const loads = await openSlots();
  if (loads.length === 0) {
    console.log("no open slots");
    return;
  }

  const minImprovement = (await publicClient.readContract({
    abi: marketAbi,
    address: CONTRACTS.market,
    functionName: "minImprovementBps",
  })) as bigint;

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

      // ---- holding a position: is it still worth holding?
      if (slot.underwriter.toLowerCase() === account.address.toLowerCase()) {
        const debt = (await publicClient.readContract({
          abi: vaultAbi,
          address: CONTRACTS.vault,
          functionName: "outstanding",
          args: [load.assetId],
        })) as bigint;

        // An exhausted reserve means the commitment has stopped being paid for.
        // Capital is locked against a purchase obligation earning nothing, so
        // release it - but never out from under a live loan, which the contract
        // refuses anyway.
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
            (debt > 0n ? ` · ${fmt(debt)} drawn` : " · undrawn") +
            ` · reserve ${fmt(slot.premiumReserve)}`,
        );
        continue;
      }

      // ---- otherwise: grade, price, and decide
      const {assessment, cached} = await gradeCached(load, agent.mandate);
      const quote = price(load, agent.mandate, assessment);
      const mark = cached ? "·" : "*"; // * = the model was actually consulted
      const graded = `${tag} ${assessment.grade.padEnd(6)}${mark}`;

      if (quote.abstain) {
        console.log(`${graded} ABSTAIN  ${assessment.rationale}`);
        continue;
      }

      let floor = quote.floor;
      let rate = quote.premiumRate;
      let why = "opens the book";

      if (slot.underwriter !== ZERO) {
        const move = contest(quote, slot, minImprovement);
        if (!move) {
          console.log(`${graded} PASS     ${fmt(quote.floor)} cannot better ${fmt(slot.floor)}`);
          continue;
        }
        floor = move.floor;
        rate = move.rate;
        why = move.why;
      }

      const balance = (await publicClient.readContract({
        abi: erc20Abi,
        address: CONTRACTS.stable,
        functionName: "balanceOf",
        args: [account.address],
      })) as bigint;

      if (balance < floor) {
        console.log(`${graded} UNFUNDED holds ${fmt(balance)}, needs ${fmt(floor)}`);
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
        args: [load.assetId, floor, rate],
      });
      await publicClient.waitForTransactionReceipt({hash});

      console.log(`${graded} BID      ${fmt(floor)} · ${why}  [${assessment.source}] ${hash}`);
      console.log(`  ${" ".repeat(21)}${assessment.rationale}`);
    }

    const standing = await publicClient.readContract({
      abi: marketAbi,
      address: CONTRACTS.market,
      functionName: "currentFloor",
      args: [load.assetId],
    });
    console.log(`  standing floor -> ${fmt(standing)}`);
  }
}

async function main() {
  const autonomy = autonomyFor(chain.id);

  console.log(
    `chain:    ${chain.id} (${chain.name})` +
      `\nsettles:  ${CONTRACTS.stable} (${DECIMALS} decimals)` +
      `\njudgment: ${process.env.OPENAI_API_KEY ? `model (${MODEL})` : "rubric"}` +
      `, ${cache.size()} grade(s) cached`,
  );

  if (!autonomy.allowed) {
    console.error(`\nREFUSING TO RUN UNATTENDED.\n${autonomy.reason}`);
    process.exit(1);
  }

  if (autonomy.overridden) {
    console.warn(`\n!! ${autonomy.reason}`);
  }

  const agents = loadAgents();
  console.log(`agents:   ${agents.map((a) => a.mandate.name).join(", ")}`);
  console.log(`\n* = model consulted   · = cached grade reused\n`);

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
