"use client";

import {useEffect, useState} from "react";
import {createPublicClient, http, type Address} from "viem";

import {addresses} from "./addresses";
import {botChain} from "./chain";
import {counterpartyAbi} from "./abi";

/**
 * The counterparty ontology.
 *
 * A receivable commits an obligor address. A credit desk cannot manage
 * concentration it cannot name, so CounterpartyRegistry maps that address to
 * an entity. This hook resolves the whole book once and hands back a lookup.
 *
 * Verification here is a governance claim, not a proof - a registrar asserted
 * the entity is who it says. The document hash on AssetRegistry is the
 * cryptographic commitment; this is the social layer beside it, and the UI
 * must never present the two as the same kind of fact.
 */

export const ROLE = ["Unknown", "Shipper", "Carrier", "Broker", "Insurer"] as const;
export const STATUS = ["Unregistered", "Pending", "Verified", "Restricted"] as const;

export interface Entity {
  address: Address;
  name: string;
  jurisdiction: string;
  role: (typeof ROLE)[number];
  status: (typeof STATUS)[number];
  registeredAt: bigint;
  evidenceHash: `0x${string}`;
}

export function useOntology(refreshKey = 0) {
  const [entities, setEntities] = useState<Map<string, Entity>>(new Map());
  const [list, setList] = useState<Entity[]>([]);

  useEffect(() => {
    if (!addresses.counterparty) return;
    let cancelled = false;
    const client = createPublicClient({chain: botChain, transport: http()});

    const read = async () => {
      try {
        const accounts = (await client.readContract({
          abi: counterpartyAbi,
          address: addresses.counterparty!,
          functionName: "accounts",
        })) as Address[];

        const rows = await Promise.all(
          accounts.map(async (a) => {
            const e = (await client.readContract({
              abi: counterpartyAbi,
              address: addresses.counterparty!,
              functionName: "entityOf",
              args: [a],
            })) as {
              name: string;
              jurisdiction: string;
              role: number;
              status: number;
              registeredAt: bigint;
              evidenceHash: `0x${string}`;
            };
            return {
              address: a,
              name: e.name,
              jurisdiction: e.jurisdiction,
              role: ROLE[e.role] ?? "Unknown",
              status: STATUS[e.status] ?? "Unregistered",
              registeredAt: e.registeredAt,
              evidenceHash: e.evidenceHash,
            } as Entity;
          }),
        );

        if (cancelled) return;
        setList(rows);
        setEntities(new Map(rows.map((r) => [r.address.toLowerCase(), r])));
      } catch {
        /* registry unreachable; callers fall back to the raw address */
      }
    };

    read();
    const t = setInterval(read, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refreshKey]);

  return {entities, list};
}

/** Entity name when the chain knows one, otherwise the address itself. */
export function nameOf(entities: Map<string, Entity>, address?: string): string | null {
  if (!address) return null;
  return entities.get(address.toLowerCase())?.name ?? null;
}
