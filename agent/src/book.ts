import {formatUnits, parseAbiItem} from "viem";

import {CONTRACTS, DECIMALS, marketAbi, publicClient, registryAbi} from "./chain";
import * as cache from "./cache";
import {assess, MODEL} from "./underwrite";
import type {Assessment, Load, Mandate} from "./types";

/**
 * Reading the book, and grading it.
 *
 * Shared by the unattended loop and the propose/approve path so the two cannot
 * drift into disagreeing about what is open or what a load is worth. The only
 * thing that differs between them is who gets to act on the answer.
 */

const REGISTERED = parseAbiItem(
  "event Registered(uint256 indexed id, address indexed owner, bytes32 indexed docHash, uint128 faceValue)",
);

export const fmt = (v: bigint) =>
  Number(formatUnits(v, DECIMALS)).toLocaleString("en-US", {maximumFractionDigits: 2});

/**
 * Every asset with a slot currently open for bidding.
 *
 * Discovered from `Registered` logs rather than by walking ids. A fixed range
 * goes blind past its ceiling, and stopping at the first missing id goes blind
 * behind any gap - both of which look identical to an empty book.
 */
export async function openSlots(): Promise<Load[]> {
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

/**
 * Grade a load for a book, reusing an earlier grade when nothing it depends on
 * has changed.
 *
 * The cache is what makes an unattended loop affordable and, more importantly,
 * stable: the same load does not quietly acquire a different opinion between
 * sweeps just because it was asked twice.
 */
export async function gradeCached(
  load: Load,
  mandate: Mandate,
): Promise<{assessment: Assessment; cached: boolean}> {
  const key = cache.keyFor(load, mandate, MODEL);

  const hit = cache.get(key);
  if (hit) return {assessment: hit, cached: true};

  const assessment = await assess(load, mandate);
  cache.put(key, assessment, {book: mandate.name, assetId: load.assetId, model: MODEL});
  return {assessment, cached: false};
}
