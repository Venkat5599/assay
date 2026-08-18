"use client";

import {useEffect, useState} from "react";
import {createPublicClient, http, parseAbiItem, type Address} from "viem";

import {addresses, isDeployed} from "@/lib/addresses";
import {botChain, explorerTx} from "@/lib/chain";
import {usd, shortAddress} from "@/lib/format";
import {bookOf, ZERO} from "@/lib/useOps";

/**
 * The agent tape, read from chain.
 *
 * This replaces what used to be a pasted terminal transcript. The transcript
 * was genuine output, but a paste cannot go stale honestly - it keeps claiming
 * yesterday's numbers forever. These lines are BidPlaced logs, so the panel is
 * either current or visibly empty.
 */

const BID_PLACED = parseAbiItem(
  "event BidPlaced(uint256 indexed assetId, address indexed underwriter, address indexed displaced, uint256 floor, uint256 premiumRate)",
);

interface Row {
  assetId: bigint;
  underwriter: Address;
  displaced: Address;
  floor: bigint;
  block: bigint;
  hash: `0x${string}`;
}

export function LiveTape() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!isDeployed) {
      setRows([]);
      return;
    }
    let cancelled = false;
    const client = createPublicClient({chain: botChain, transport: http()});

    const read = () =>
      client
        .getLogs({address: addresses.market, event: BID_PLACED, fromBlock: 0n})
        .then((logs) => {
          if (cancelled) return;
          setRows(
            logs
              .map((l) => ({
                assetId: l.args.assetId!,
                underwriter: l.args.underwriter!,
                displaced: l.args.displaced!,
                floor: l.args.floor!,
                block: l.blockNumber!,
                hash: l.transactionHash!,
              }))
              .sort((a, b) => Number(b.block - a.block)),
          );
        })
        .catch(() => undefined);

    read();
    const t = setInterval(read, 12_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="term">
      <div className="term-bar">
        <span>
          lading://agents &middot; chain {botChain.id} &middot;{" "}
          {rows === null ? "reading" : `${rows.length} bids`}
        </span>
        <span className="term-dot" aria-hidden="true" />
      </div>
      <pre className="term-body">
        {rows === null
          ? "reading BidPlaced logs from chain..."
          : rows.length === 0
            ? "no bids on this deployment yet."
            : rows
                .map(
                  (r) =>
                    `${r.block}  ${bookOf(r.underwriter).padEnd(20)}` +
                    `asset #${r.assetId}  ${usd(r.floor).padStart(10)}  ` +
                    (r.displaced === ZERO
                      ? "entered"
                      : `displaced ${shortAddress(r.displaced)}`),
                )
                .join("\n")}
      </pre>
      {rows && rows.length > 0 && (
        <div className="term-bar">
          <span>
            latest{" "}
            <a href={explorerTx(rows[0]!.hash)} target="_blank" rel="noreferrer">
              {rows[0]!.hash.slice(0, 18)}...
            </a>
          </span>
          <span>ESCROWED ON BID</span>
        </div>
      )}
    </div>
  );
}
