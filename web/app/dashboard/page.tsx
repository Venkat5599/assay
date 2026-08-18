"use client";

import {useState} from "react";
import {useAccount, useReadContract, useWriteContract} from "wagmi";

import {Wallet} from "../components/Wallet";
import {marketAbi, registryAbi, vaultAbi} from "@/lib/abi";
import {addresses, isDeployed} from "@/lib/addresses";
import {explorerAddress, IS_TESTNET} from "@/lib/chain";
import {usd, shortAddress} from "@/lib/format";

/**
 * The book. One load per row, read from chain, with the carrier actions
 * attached to whichever load is selected in the left panel.
 */

const LOADS = [
  {id: 1n, bol: "BOL-88213", shipper: "Midwest Grain Cooperative", lane: "Cedar Rapids IA / Kansas City MO", terms: "Net 90"},
  {id: 2n, bol: "BOL-90118", shipper: "Great Lakes Freight", lane: "Toledo OH / Louisville KY", terms: "Net 35"},
  {id: 3n, bol: "BOL-77450", shipper: "Gulf Intermodal", lane: "Houston TX / Memphis TN", terms: "Net 60"},
];

const AGENTS = [
  {name: "CONSERVATIVE", addr: "0xb7E28bEbBFdBbA0D7884b740cb25F358C9D9edf1", mandate: "Refuses grade C and below. Ceiling 50,000."},
  {name: "SECTOR", addr: "0x6B4Db50f8B79b739860DB1B2948243e8Af36A764", mandate: "Agricultural and regional lanes. Ceiling 120,000."},
  {name: "AGGRESSIVE", addr: "0xf739FAc50486662A5aB90273a87345e0486E6EC5", mandate: "Takes delivery willingly. Ceiling 250,000."},
];

export default function Dashboard() {
  const [selected, setSelected] = useState<bigint>(2n);
  const [busy, setBusy] = useState<string | null>(null);
  const {isConnected} = useAccount();
  const {writeContractAsync} = useWriteContract();

  const live = isDeployed;
  const poll = {enabled: live, refetchInterval: 4000} as const;

  const {data: floor} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "currentFloor",
    args: [selected], query: poll,
  });
  const {data: room} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "availableToBorrow",
    args: [selected], query: poll,
  });
  const {data: debt} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "outstanding",
    args: [selected], query: poll,
  });
  const {data: slot} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "slots",
    args: [selected], query: poll,
  });
  const {data: receivable} = useReadContract({
    abi: registryAbi, address: addresses.assetRegistry, functionName: "receivableOf",
    args: [selected], query: poll,
  });
  const {data: defaulted} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "isDefaulted",
    args: [selected], query: poll,
  });

  const load = LOADS.find((l) => l.id === selected)!;
  const underwriter = slot?.underwriter;
  const hasBid = Boolean(underwriter && underwriter !== "0x0000000000000000000000000000000000000000");

  async function run(tag: string, fn: () => Promise<unknown>) {
    setBusy(tag);
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
    <div className="dash">
      {/* ------------------------------------------------------- left panel */}
      <aside className="side">
        <div className="side-brand">
          <a href="/">LADING</a>
        </div>

        <div className="side-group">
          <span className="label">Open loads</span>
          {LOADS.map((l) => (
            <button
              key={l.bol}
              className={l.id === selected ? "side-link on" : "side-link"}
              onClick={() => setSelected(l.id)}
              aria-current={l.id === selected}
            >
              <span>{l.bol}</span>
              <span>#{l.id.toString()}</span>
            </button>
          ))}
        </div>

        <div className="side-group">
          <span className="label">Underwriters</span>
          {AGENTS.map((a) => (
            <a
              key={a.name}
              className="side-link"
              href={explorerAddress(a.addr)}
              target="_blank"
              rel="noreferrer"
            >
              <span>{a.name}</span>
              <span>{shortAddress(a.addr)}</span>
            </a>
          ))}
        </div>

        <div className="side-group">
          <span className="label">Contracts</span>
          {[
            ["MARKET", addresses.market],
            ["VAULT", addresses.vault],
            ["REGISTRY", addresses.assetRegistry],
          ].map(([name, addr]) =>
            addr ? (
              <a
                key={name as string}
                className="side-link"
                href={explorerAddress(addr as string)}
                target="_blank"
                rel="noreferrer"
              >
                <span>{name as string}</span>
                <span>{shortAddress(addr as string)}</span>
              </a>
            ) : (
              <span className="side-link" key={name as string}>
                <span>{name as string}</span>
                <span>pending</span>
              </span>
            ),
          )}
        </div>

        <div className="side-foot">
          <div>NETWORK {IS_TESTNET ? "BOT CHAIN TESTNET 968" : "BOT CHAIN 677"}</div>
          <div>{live ? "READS LIVE" : "ADDRESSES UNSET"}</div>
        </div>
      </aside>

      {/* -------------------------------------------------------- main pane */}
      <main className="dash-main">
        <div className="dash-bar">
          <div>
            <div className="dash-title">{load.bol}</div>
            <div className="num">{load.shipper}</div>
          </div>
          <div className="hero-actions" style={{marginTop: 0}}>
            <span className="live-dot">
              <i aria-hidden="true" />
              {live ? "POLLING CHAIN" : "OFFLINE"}
            </span>
            <Wallet />
          </div>
        </div>

        <div className="dash-pad">
          <div className="stats">
            <div>
              <span className="label">FACE VALUE</span>
              <div className="stat-figure">{receivable ? usd(receivable.faceValue) : "--"}</div>
              <div className="stat-note">{load.terms}</div>
            </div>
            <div>
              <span className="label">STANDING BID</span>
              <div className="stat-figure">{usd(floor as bigint | undefined)}</div>
              <div className="stat-note">{hasBid ? "escrowed in full" : "no bid yet"}</div>
            </div>
            <div>
              <span className="label">DRAWABLE</span>
              <div className="stat-figure">{usd(room as bigint | undefined)}</div>
              <div className="stat-note">floor less haircut</div>
            </div>
            <div>
              <span className="label">OUTSTANDING</span>
              <div className="stat-figure">{usd(debt as bigint | undefined)}</div>
              <div className="stat-note">{defaulted ? "callable" : "within headroom"}</div>
            </div>
          </div>

          <div className="panel-title">
            <h2>Load</h2>
            <span className="num">ASSET #{selected.toString()}</span>
          </div>
          <div className="book">
            {[
              ["LANE", load.lane],
              ["SHIPPER", load.shipper],
              ["TERMS", load.terms],
              ["OBLIGOR", receivable ? shortAddress(receivable.debtor) : "--"],
              [
                "DOC HASH",
                receivable ? `${receivable.docHash.slice(0, 18)}...` : "--",
              ],
              ["INCUMBENT", hasBid ? shortAddress(underwriter) : "none"],
            ].map(([k, v]) => (
              <div className="book-row" key={k as string}>
                <span className="book-name">{k as string}</span>
                <span className="book-grade" />
                <span className="book-price" style={{fontSize: "0.82rem", fontWeight: 400}}>
                  {v as string}
                </span>
                <span className="book-why" />
              </div>
            ))}
          </div>

          <div className="panel-title">
            <h2>Carrier actions</h2>
            <span className="num">{canAct ? "READY" : "CONNECT A WALLET"}</span>
          </div>
          <div className="hero-actions" style={{marginTop: 0}}>
            <button
              className="btn onDark"
              disabled={!canAct || busy !== null || !room}
              onClick={() =>
                run("borrow", () =>
                  writeContractAsync({
                    abi: vaultAbi,
                    address: addresses.vault!,
                    functionName: "borrow",
                    args: [selected, (room as bigint) ?? 0n],
                  }),
                )
              }
            >
              {busy === "borrow" ? "Drawing" : "Draw maximum"} <span aria-hidden="true">&gt;</span>
            </button>
            <button
              className="btn onDark"
              disabled={!canAct || busy !== null || !debt}
              onClick={() =>
                run("repay", () =>
                  writeContractAsync({
                    abi: vaultAbi,
                    address: addresses.vault!,
                    functionName: "repay",
                    args: [selected, (debt as bigint) ?? 0n],
                  }),
                )
              }
            >
              {busy === "repay" ? "Repaying" : "Repay in full"}
            </button>
            <button
              className="btn onDark"
              disabled={!canAct || busy !== null || !defaulted}
              onClick={() =>
                run("settle", () =>
                  writeContractAsync({
                    abi: marketAbi,
                    address: addresses.market!,
                    functionName: "settleDefault",
                    args: [selected],
                  }),
                )
              }
            >
              {busy === "settle" ? "Settling" : "Settle default"}
            </button>
          </div>

          <p className="callout">
            <b>Settle default is disabled until the position is actually callable.</b> It becomes
            available when the receivable matures unpaid, or when floor decay compresses headroom
            below the outstanding debt. The contract enforces this regardless of what this page
            shows.
          </p>
        </div>
      </main>
    </div>
  );
}
