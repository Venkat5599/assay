"use client";

import {useMemo, useState} from "react";
import {useAccount, useReadContract, useWriteContract} from "wagmi";

import {Wallet} from "./components/Wallet";
import {marketAbi, registryAbi, vaultAbi} from "@/lib/abi";
import {addresses, isDeployed} from "@/lib/addresses";
import {explorerAddress} from "@/lib/chain";
import {usd, shortAddress} from "@/lib/format";

/**
 * The asset on display. One real bill of lading, registered on-chain, with its
 * document hash committed. Until contracts are deployed the page still renders
 * every figure - it simply reads them from the recorded terms rather than from
 * chain state. Content is never gated on a network call.
 */
const LOAD = {
  assetId: 1n,
  bolNumber: "BOL-88213",
  shipper: "Midwest Grain Cooperative",
  lane: "Cedar Rapids, IA → Kansas City, MO",
  commodity: "Bulk corn, 42,000 lb",
  delivered: "2026-08-11",
  terms: "Net 90",
  faceValue: 18_400_00n * 10n ** 16n, // 18,400.00
  docHash: "0x9f2c…4ab1",
};

/** Agent underwriters. Three mandates, three different numbers. */
const AGENTS = [
  {
    name: "CONSERVATIVE",
    floor: "14,720",
    why: "Shipper has a clean file but the lane is thin on backhaul. Discounting for a 90-day tail I cannot hedge.",
  },
  {
    name: "SECTOR",
    floor: "15,640",
    why: "Grain co-ops settle. I underwrite this lane weekly and have never taken delivery on one.",
    lead: true,
  },
  {
    name: "AGGRESSIVE",
    floor: "15,180",
    why: "Face value is fair and the commodity is liquid. I would rather own the receivable than miss the premium.",
  },
];

export default function Page() {
  const {address, isConnected} = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const {writeContractAsync} = useWriteContract();

  const live = isDeployed;

  const {data: floor} = useReadContract({
    abi: marketAbi,
    address: addresses.market,
    functionName: "currentFloor",
    args: [LOAD.assetId],
    query: {enabled: live, refetchInterval: 3000},
  });

  const {data: room} = useReadContract({
    abi: vaultAbi,
    address: addresses.vault,
    functionName: "availableToBorrow",
    args: [LOAD.assetId],
    query: {enabled: live, refetchInterval: 3000},
  });

  const {data: debt} = useReadContract({
    abi: vaultAbi,
    address: addresses.vault,
    functionName: "outstanding",
    args: [LOAD.assetId],
    query: {enabled: live, refetchInterval: 3000},
  });

  const figures = useMemo(
    () => [
      {label: "FACE VALUE", value: usd(LOAD.faceValue), unit: "USD"},
      {label: "STANDING BID", value: live ? usd(floor) : "15,640", unit: "USD"},
      {label: "AVAILABLE TO DRAW", value: live ? usd(room) : "12,512", unit: "USD"},
      {label: "OUTSTANDING", value: live ? usd(debt) : "0", unit: "USD"},
    ],
    [live, floor, room, debt],
  );

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(null);
    }
  }

  const canAct = isConnected && live;

  return (
    <>
      <header className="shell">
        <nav className="nav">
          <h1 className="mark">
            LAD<span>I</span>NG
          </h1>
          <span className="nav-meta">BOT CHAIN 677 / FREIGHT RECEIVABLES</span>
        </nav>
      </header>

      <main className="shell">
        <section className="hero">
          <div>
            <span className="stamp">DELIVERED &middot; UNPAID &middot; FINANCEABLE</span>
            <h1>
              The load moved.
              <br />
              <em>The money didn&rsquo;t.</em>
            </h1>
            <p>
              Underwriters post a firm bid on this invoice and escrow the purchase price in
              full, before any loan exists. If the carrier defaults, the escrow settles to the
              lender and the invoice transfers to the underwriter &mdash; one block, no
              auction, no oracle, no secondary market.
            </p>
            <div className="actions">
              <Wallet />
              <a
                className="act quiet"
                href="https://github.com/Venkat5599/assay"
                target="_blank"
                rel="noreferrer"
              >
                SOURCE <span className="caret">&rsaquo;</span>
              </a>
            </div>
          </div>

          {/* The signature artifact: the document that IS the collateral. */}
          <article className="bol">
            <header className="bol-head">
              <span className="bol-title">BILL OF LADING</span>
              <span className="bol-no">{LOAD.bolNumber}</span>
            </header>
            <dl>
              <div className="bol-row">
                <dt>SHIPPER</dt>
                <dd>{LOAD.shipper}</dd>
              </div>
              <div className="bol-row">
                <dt>LANE</dt>
                <dd>{LOAD.lane}</dd>
              </div>
              <div className="bol-row">
                <dt>COMMODITY</dt>
                <dd>{LOAD.commodity}</dd>
              </div>
              <div className="bol-row">
                <dt>DELIVERED</dt>
                <dd>{LOAD.delivered}</dd>
              </div>
              <div className="bol-row">
                <dt>TERMS</dt>
                <dd>{LOAD.terms}</dd>
              </div>
              <div className="bol-row">
                <dt>DOC HASH</dt>
                <dd>{LOAD.docHash}</dd>
              </div>
            </dl>
            <footer className="bol-foot">
              <span>ASSET #{LOAD.assetId.toString()}</span>
              <span>
                {addresses.assetRegistry ? (
                  <a href={explorerAddress(addresses.assetRegistry)} target="_blank" rel="noreferrer">
                    REGISTRY {shortAddress(addresses.assetRegistry)}
                  </a>
                ) : (
                  "REGISTRY PENDING DEPLOYMENT"
                )}
              </span>
            </footer>
          </article>
        </section>

        <section className="auction">
          <div className="section-head">
            <h2>Three underwriters, three numbers</h2>
            <p>{live ? "LIVE · POLLED FROM CHAIN" : "RECORDED TERMS · AWAITING DEPLOYMENT"}</p>
          </div>

          <dl className="figures">
            {figures.map((f) => (
              <div className="figure" key={f.label}>
                <dt>{f.label}</dt>
                <dd>
                  {f.value}
                  <small>{f.unit}</small>
                </dd>
              </div>
            ))}
          </dl>

          <div className="bidders">
            {AGENTS.map((a) => (
              <div className={a.lead ? "bidder lead" : "bidder"} key={a.name}>
                <span className="bidder-name">
                  <i className="tick" aria-hidden="true" />
                  <b>{a.name}</b>
                </span>
                <span className="bidder-price">{a.floor}</span>
                <p className="bidder-why">{a.why}</p>
              </div>
            ))}
          </div>

          <div className="actions">
            <button
              className="act"
              disabled={!canAct || busy !== null}
              onClick={() =>
                run("borrow", () =>
                  writeContractAsync({
                    abi: vaultAbi,
                    address: addresses.vault!,
                    functionName: "borrow",
                    args: [LOAD.assetId, (room as bigint) ?? 0n],
                  }),
                )
              }
            >
              {busy === "borrow" ? "DRAWING" : "DRAW AGAINST THIS LOAD"}
              <span className="caret">&rsaquo;</span>
            </button>

            <button
              className="act quiet"
              disabled={!canAct || busy !== null || !debt}
              onClick={() =>
                run("repay", () =>
                  writeContractAsync({
                    abi: vaultAbi,
                    address: addresses.vault!,
                    functionName: "repay",
                    args: [LOAD.assetId, (debt as bigint) ?? 0n],
                  }),
                )
              }
            >
              {busy === "repay" ? "REPAYING" : "REPAY"}
              <span className="caret">&rsaquo;</span>
            </button>
          </div>

          {!live && (
            <p className="notice">
              <b>Contracts are not yet deployed to BOT Chain mainnet.</b> Every figure above is
              read from the recorded terms of this load. Set the four{" "}
              <code>NEXT_PUBLIC_*</code> addresses and the same screen reads them from chain
              state instead &mdash; the controls go live, nothing else changes.
            </p>
          )}

          {live && !isConnected && (
            <p className="notice">
              <b>Connect a wallet to draw against this load.</b> Reads are live; writes need a
              signer on chain 677.
            </p>
          )}
        </section>

        <section className="auction">
          <div className="section-head">
            <h2>Why this is lendable when a bank says no</h2>
            <p>NO ORACLE &middot; NO AUCTION &middot; NO SECONDARY MARKET</p>
          </div>
          <div className="bidders">
            <div className="bidder">
              <span className="bidder-name">
                <i className="tick" aria-hidden="true" />
                <b>ESCROW FIRST</b>
              </span>
              <span className="bidder-price">100%</span>
              <p className="bidder-why">
                The purchase price is funded before origination, not discovered at auction. The
                loss floor exists before the loan does.
              </p>
            </div>
            <div className="bidder">
              <span className="bidder-name">
                <i className="tick" aria-hidden="true" />
                <b>CONTESTABLE</b>
              </span>
              <span className="bidder-price">ALWAYS</span>
              <p className="bidder-why">
                Any underwriter may displace the incumbent with a higher floor or a lower
                premium. Competition to buy is what prices an asset with no orderbook.
              </p>
            </div>
            <div className="bidder">
              <span className="bidder-name">
                <i className="tick" aria-hidden="true" />
                <b>DECAY</b>
              </span>
              <span className="bidder-price">PER BLOCK</span>
              <p className="bidder-why">
                An uncontested floor falls every block until headroom vanishes and the position
                becomes callable. Risk parameters update without a vote.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="shell">
          <div className="footer-grid">
            <span>LADING &middot; FREIGHT RECEIVABLE CREDIT</span>
            <span>BOT CHAIN BUILDER CHALLENGE #2 &middot; RWA</span>
            <span>{address ? shortAddress(address) : "NOT CONNECTED"}</span>
          </div>
        </div>
        <p className="footer-word">LADING</p>
      </footer>
    </>
  );
}
