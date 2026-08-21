"use client";

import {useEffect, useState} from "react";
import {createPublicClient, http, parseAbiItem, type Address} from "viem";

import {botChain, explorerAddress} from "@/lib/chain";
import {addresses} from "@/lib/addresses";
import {usd, shortAddress} from "@/lib/format";
import {bookOf} from "@/lib/useOps";

/**
 * The book, read from chain.
 *
 * Every row here is a BidPlaced log emitted by FirmBidMarket - the underwriter
 * address, the floor they escrowed, and the party they displaced. Nothing is
 * hardcoded, which means an empty book renders as empty rather than as a
 * plausible-looking fiction.
 */

const BID_PLACED = parseAbiItem(
  "event BidPlaced(uint256 indexed assetId, address indexed underwriter, address indexed displaced, uint256 floor, uint256 premiumRate)",
);


interface Bid {
  underwriter: Address;
  displaced: Address;
  floor: bigint;
  block: bigint;
  hash: string;
}

export function LiveBook({assetId}: {assetId: bigint}) {
  const [bids, setBids] = useState<Bid[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!addresses.market) return;
    let cancelled = false;

    const client = createPublicClient({chain: botChain, transport: http()});

    const read = async () => {
      try {
        const logs = await client.getLogs({
          address: addresses.market,
          event: BID_PLACED,
          args: {assetId},
          fromBlock: 0n,
          toBlock: "latest",
        });
        if (cancelled) return;
        setBids(
          logs.map((l) => ({
            underwriter: l.args.underwriter!,
            displaced: l.args.displaced!,
            floor: l.args.floor!,
            block: l.blockNumber!,
            hash: l.transactionHash!,
          })),
        );
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    read();
    const id = setInterval(read, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [assetId]);

  if (!addresses.market) {
    return <p className="callout">Market address is not configured in this build.</p>;
  }

  if (error) {
    return (
      <p className="callout">
        <b>Could not read the book.</b> {error}
      </p>
    );
  }

  if (bids === null) {
    return <p className="callout">Reading BidPlaced logs from chain&hellip;</p>;
  }

  if (bids.length === 0) {
    return (
      <p className="callout">
        <b>No bids on this load.</b> Nobody has committed capital to buy it, so it is not
        financeable and the protocol says so. Absence of a bid is information, not an error.
      </p>
    );
  }

  const incumbent = bids[bids.length - 1]!;

  return (
    <div className="book">
      {bids.map((b, i) => {
        const lead = i === bids.length - 1;
        return (
          <div className={lead ? "book-row lead" : "book-row"} key={b.hash}>
            <span className="book-name">
              <span className="caret" aria-hidden="true">
                {lead ? ">>" : "--"}
              </span>
              {bookOf(b.underwriter)}
            </span>
            <span className="book-grade">BLOCK {b.block.toString()}</span>
            <span className="book-price">{usd(b.floor)}</span>
            <span className="book-why">
              <a href={explorerAddress(b.underwriter)} target="_blank" rel="noreferrer">
                {shortAddress(b.underwriter)}
              </a>
              {b.displaced !== "0x0000000000000000000000000000000000000000" && (
                <> &middot; displaced {shortAddress(b.displaced)}</>
              )}
              {lead && <> &middot; holds the slot</>}
            </span>
          </div>
        );
      })}
      <div className="book-row">
        <span className="book-name">STANDING</span>
        <span className="book-grade">{bids.length} BIDS</span>
        <span className="book-price">{usd(incumbent.floor)}</span>
        <span className="book-why">
          Read from BidPlaced logs on chain {botChain.id}. Nothing on this row is stored in the
          page.
        </span>
      </div>
    </div>
  );
}
