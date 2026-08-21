"use client";

import {useCallback, useEffect, useState} from "react";
import {createPublicClient, http, parseAbiItem, type Address} from "viem";
import {useAccount, usePublicClient, useWriteContract} from "wagmi";

import {addresses, isDeployed} from "./addresses";
import {botChain} from "./chain";
import {erc20Abi} from "./abi";

/**
 * Assets are discovered from Registered logs, never from a list in the code.
 * If nobody has registered anything the app shows an empty portfolio, which is
 * the truth.
 */
const REGISTERED = parseAbiItem(
  "event Registered(uint256 indexed id, address indexed owner, bytes32 indexed docHash, uint128 faceValue)",
);

export interface RegisteredAsset {
  id: bigint;
  owner: Address;
  docHash: `0x${string}`;
  faceValue: bigint;
  block: bigint;
}

export function useRegisteredAssets(refreshKey = 0) {
  // With no registry address there is nothing to read and never will be, so
  // the empty result is the initial state. Writing it from the effect meant a
  // second render to reach a value already known at mount.
  const [assets, setAssets] = useState<RegisteredAsset[] | null>(
    addresses.assetRegistry ? null : [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addresses.assetRegistry) return;
    let cancelled = false;
    const client = createPublicClient({chain: botChain, transport: http()});

    const read = async () => {
      try {
        const logs = await client.getLogs({
          address: addresses.assetRegistry,
          event: REGISTERED,
          fromBlock: 0n,
          toBlock: "latest",
        });
        if (cancelled) return;
        setAssets(
          logs.map((l) => ({
            id: l.args.id!,
            owner: l.args.owner!,
            docHash: l.args.docHash!,
            faceValue: l.args.faceValue!,
            block: l.blockNumber!,
          })),
        );
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    read();
    const t = setInterval(read, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [refreshKey]);

  return {assets, error};
}

export type TxState =
  | {status: "idle"}
  | {status: "pending"; label: string}
  | {status: "done"; hash: `0x${string}`}
  | {status: "error"; message: string};

/**
 * Runs a sequence of writes, waiting for each receipt before the next.
 *
 * Waiting matters: an approve that is merely submitted, not mined, makes the
 * transfer that follows revert. That exact race broke the agent runner, and it
 * would break every form here for the same reason.
 */
export function useTxRunner() {
  const [state, setState] = useState<TxState>({status: "idle"});
  const {writeContractAsync} = useWriteContract();
  const publicClient = usePublicClient();

  const run = useCallback(
    async (steps: {label: string; call: () => Promise<`0x${string}`>}[]) => {
      try {
        let last: `0x${string}` | null = null;
        for (const step of steps) {
          setState({status: "pending", label: step.label});
          const hash = await step.call();
          await publicClient?.waitForTransactionReceipt({hash});
          last = hash;
        }
        setState({status: "done", hash: last!});
        return true;
      } catch (err) {
        const raw = (err as Error).message ?? "transaction failed";
        // Wallet rejections and contract reverts read very differently; keep
        // the first line, which is the part a user can act on.
        setState({status: "error", message: raw.split("\n")[0]!.slice(0, 180)});
        return false;
      }
    },
    [publicClient],
  );

  const reset = useCallback(() => setState({status: "idle"}), []);
  return {state, run, reset, writeContractAsync};
}

/** Balance + allowance for the settlement token, polled. */
export function useToken(spender?: Address) {
  const {address} = useAccount();
  const publicClient = usePublicClient();
  const [balance, setBalance] = useState<bigint>();
  const [allowance, setAllowance] = useState<bigint>();

  useEffect(() => {
    if (!address || !addresses.stable || !publicClient || !isDeployed) return;
    let cancelled = false;

    const read = async () => {
      const [b, a] = await Promise.all([
        publicClient.readContract({
          abi: erc20Abi,
          address: addresses.stable!,
          functionName: "balanceOf",
          args: [address],
        }),
        spender
          ? publicClient.readContract({
              abi: erc20Abi,
              address: addresses.stable!,
              functionName: "allowance",
              args: [address, spender],
            })
          : Promise.resolve(0n),
      ]);
      if (cancelled) return;
      setBalance(b as bigint);
      setAllowance(a as bigint);
    };

    read().catch(() => undefined);
    const t = setInterval(() => read().catch(() => undefined), 6000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [address, spender, publicClient]);

  return {balance, allowance};
}
