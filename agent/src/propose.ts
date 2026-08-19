import {privateKeyToAccount} from "viem/accounts";
import {writeFileSync} from "node:fs";

import {CONTRACTS, DECIMALS, marketAbi, publicClient} from "./chain";
import {fmt, gradeCached, openSlots} from "./book";
import {contest, type Slot} from "./contest";
import {MANDATES} from "./mandates";
import {price} from "./pricing";
import {MODEL} from "./underwrite";
import type {Proposal} from "./types";

/**
 * PROPOSE. Reads the book, grades it, prices it, and stops.
 *
 * Nothing here touches a wallet. The agents form opinions and write them down;
 * a person decides whether any of it reaches the chain. That boundary is the
 * point - the model's judgment is worth having and is not worth trusting
 * unattended with capital, and the honest way to hold both of those at once is
 * to make the approval a separate, deliberate act.
 *
 * The file this writes is the audit record `PRODUCTION.md` asks for: model id,
 * inputs, grade, rationale, and the number the kernel derived from that grade.
 * Any proposal can be re-read months later and checked against what the chain
 * actually did.
 *
 *   bun run propose        grade every open slot, write proposals.json
 */

const OUT = process.env.PROPOSALS_FILE ?? "proposals.json";
const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const agents = Object.entries(MANDATES)
    .map(([slug, mandate]) => ({
      slug,
      mandate,
      key: process.env[`AGENT_${slug.toUpperCase()}_KEY`] as `0x${string}` | undefined,
    }))
    .filter((a) => a.key);

  if (agents.length === 0) throw new Error("no agent keys found - set AGENT_CONSERVATIVE_KEY etc.");

  console.log(
    `judgment: ${process.env.OPENAI_API_KEY ? `model (${MODEL})` : "rubric"}` +
      `\nmarket:   ${CONTRACTS.market}` +
      `\nsettles:  ${CONTRACTS.stable} (${DECIMALS} decimals)\n`,
  );

  const loads = await openSlots();
  if (loads.length === 0) {
    console.log("no open slots - nothing to grade");
    writeFileSync(OUT, JSON.stringify({generatedAt: new Date().toISOString(), proposals: []}, null, 2));
    return;
  }

  const minImprovement = (await publicClient.readContract({
    abi: marketAbi,
    address: CONTRACTS.market,
    functionName: "minImprovementBps",
  })) as bigint;

  const proposals: Proposal[] = [];

  for (const load of loads) {
    console.log(`\nasset #${load.assetId} · face ${fmt(load.faceValue)} · doc ${load.docHash.slice(0, 10)}`);

    for (const agent of agents) {
      const account = privateKeyToAccount(agent.key!);
      const tag = `  ${agent.mandate.name.padEnd(13)}`;

      const slot = (await publicClient.readContract({
        abi: marketAbi,
        address: CONTRACTS.market,
        functionName: "slots",
        args: [load.assetId],
      })) as unknown as Slot;

      if (slot.underwriter.toLowerCase() === account.address.toLowerCase()) {
        console.log(`${tag} HOLDS    ${fmt(slot.floor)} - already the incumbent`);
        continue;
      }

      const {assessment} = await gradeCached(load, agent.mandate);
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
        const move = contest(quote, slot, minImprovement);
        if (!move) {
          console.log(`${graded} PASS     ${fmt(quote.floor)} cannot better ${fmt(slot.floor)}`);
          continue;
        }
        floor = move.floor;
        rate = move.rate;
        why = move.why;
      }

      proposals.push({
        agent: agent.slug,
        book: agent.mandate.name,
        underwriter: account.address,
        assetId: load.assetId.toString(),
        faceValue: load.faceValue.toString(),
        docHash: load.docHash,
        grade: assessment.grade,
        rationale: assessment.rationale,
        source: assessment.source,
        model: assessment.source === "model" ? MODEL : "rubric",
        floor: floor.toString(),
        premiumRate: rate.toString(),
        reason: why,
        // Snapshotted so `execute` can tell whether the book moved underneath
        // a proposal before anyone approved it.
        observedFloor: slot.floor.toString(),
        observedUnderwriter: slot.underwriter,
        proposedAt: new Date().toISOString(),
      });

      console.log(`${graded} PROPOSE  ${fmt(floor)} · ${why}  [${assessment.source}]`);
      console.log(`  ${" ".repeat(20)}${assessment.rationale}`);
    }
  }

  writeFileSync(
    OUT,
    JSON.stringify({generatedAt: new Date().toISOString(), model: MODEL, proposals}, null, 2),
  );

  console.log(`\n${proposals.length} proposal(s) written to ${OUT}`);
  if (proposals.length > 0) {
    console.log("Nothing has touched the chain. Review, then:");
    console.log("  bun run execute -- --yes            approve every proposal");
    console.log("  bun run execute -- --yes --agent conservative");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
