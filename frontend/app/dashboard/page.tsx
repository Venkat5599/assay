"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {useAccount} from "wagmi";

import {Overlay} from "../components/Reveal";
import {Wallet} from "../components/Wallet";
import {NetworkBadge, NetworkSwitch} from "../components/NetworkSwitch";
import {
  Audit, BidBook, CommandCenter, Desks, Exposure, Funding, LoanBook, Origination,
  Portfolio, Protocol, RiskMonitor, Servicing, Underwriting, WorkQueue, Counterparties,
} from "./Screens";
import {CreditCase} from "./CreditCase";
import {SettleButton} from "../components/Forms";
import {addresses, isDeployed} from "@/lib/addresses";
import {IS_TESTNET} from "@/lib/chain";
import {switchNetwork} from "@/lib/networks";
import {usd, shortAddress, bolRef} from "@/lib/format";
import {useOps, useWorkQueue} from "@/lib/useOps";
import {useToken} from "@/lib/useChain";

/**
 * Credit operations workstation.
 *
 * Navigation follows the lifecycle a credit desk actually works - origination,
 * credit, capital, servicing - rather than the contract layout. Every screen
 * reads from one shared chain reader; nothing is seeded.
 */

type Screen =
  | "command" | "queue" | "portfolio" | "exposure"
  | "receivables" | "origination" | "counterparties"
  | "underwriting" | "bidbook" | "risk"
  | "funding" | "loanbook"
  | "servicing"
  | "desks"
  | "audit" | "protocol"
  | "case";

const NAV: {group: string; items: {id: Screen; label: string}[]}[] = [
  {
    group: "Workspace",
    items: [
      {id: "command", label: "Command center"},
      {id: "queue", label: "Work queue"},
      {id: "portfolio", label: "Portfolio"},
      {id: "exposure", label: "Exposure"},
    ],
  },
  {
    group: "Origination",
    items: [
      {id: "receivables", label: "Receivables"},
      {id: "counterparties", label: "Counterparties"},
      {id: "origination", label: "New facility"},
    ],
  },
  {
    group: "Credit",
    items: [
      {id: "underwriting", label: "Underwriting"},
      {id: "bidbook", label: "Bid book"},
      {id: "risk", label: "Risk monitor"},
    ],
  },
  {
    group: "Capital",
    items: [
      {id: "funding", label: "Funding"},
      {id: "loanbook", label: "Loan book"},
    ],
  },
  {
    group: "Servicing",
    items: [{id: "servicing", label: "Settlements"}],
  },
  {
    group: "Intelligence",
    items: [{id: "desks", label: "Underwriter agents"}],
  },
  {
    group: "Control",
    items: [
      {id: "audit", label: "Audit trail"},
      {id: "protocol", label: "Protocol"},
    ],
  },
];

const TITLES: Record<Screen, string> = {
  command: "Command center", queue: "Work queue", portfolio: "Portfolio", exposure: "Exposure",
  receivables: "Receivables", counterparties: "Counterparties", origination: "New facility", underwriting: "Underwriting desk",
  bidbook: "Bid book", risk: "Risk monitor", funding: "Funding", loanbook: "Loan book",
  servicing: "Settlement operations", desks: "Underwriter agents", audit: "Audit trail",
  protocol: "Protocol", case: "Credit case",
};

export default function Workstation() {
  const base = useOps();
  const refresh = base.refresh;
  const settleAction = useCallback(
    (p: {id: bigint; defaulted: boolean}) => (
      <SettleButton assetId={p.id} enabled={p.defaulted} onDone={refresh} />
    ),
    [refresh],
  );
  const ops = useMemo(() => ({...base, settleAction}), [base, settleAction]);
  const {address, isConnected} = useAccount();
  const {balance} = useToken();
  const [screen, setScreen] = useState<Screen>("command");
  const [picked, setPicked] = useState<bigint | null>(null);
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState("");

  const queue = useWorkQueue(ops.positions);

  // The newest position is where a fresh visit should land. Deriving it beats
  // writing it back from an effect: the same answer, without a second render
  // of the whole workstation every time the book moves.
  const selected = picked ?? ops.positions[ops.positions.length - 1]?.id ?? null;

  const go = (s: string, id?: bigint) => {
    if (id !== undefined) setPicked(id);
    setScreen(s as Screen);
    setPalette(false);
  };


  // Command palette. A workstation should be keyboard-reachable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nav = NAV.flatMap((g) => g.items).map((i) => ({
      kind: "screen" as const, label: i.label, hint: "go to", id: i.id,
    }));
    const assets = ops.positions.map((p) => ({
      kind: "asset" as const,
      label: bolRef(p.docHash),
      hint: `${usd(p.face)} · ${p.status} · obligor ${shortAddress(p.obligor)}`,
      id: p.id,
    }));
    const all = [...nav, ...assets];
    if (!q) return all.slice(0, 9);
    return all
      .filter((r) => `${r.label} ${r.hint}`.toLowerCase().includes(q))
      .slice(0, 9);
  }, [query, ops.positions]);

  const body = () => {
    switch (screen) {
      case "command": return <CommandCenter ops={ops} go={go} />;
      case "queue": return <WorkQueue ops={ops} go={go} />;
      case "portfolio":
      case "receivables": return <Portfolio ops={ops} go={go} />;
      case "exposure": return <Exposure ops={ops} />;
      case "counterparties": return <Counterparties />;
      case "origination": return <Origination ops={ops} />;
      case "underwriting": return <Underwriting ops={ops} go={go} />;
      case "bidbook": return <BidBook ops={ops} selected={selected} go={go} />;
      case "risk": return <RiskMonitor ops={ops} />;
      case "funding": return <Funding ops={ops} />;
      case "loanbook": return <LoanBook ops={ops} go={go} />;
      case "servicing": return <Servicing ops={ops} go={go} />;
      case "desks": return <Desks ops={ops} />;
      case "audit": return <Audit ops={ops} />;
      case "protocol": return <Protocol ops={ops} />;
      case "case":
        return selected !== null ? <CreditCase ops={ops} id={selected} go={go} /> : null;
    }
  };

  return (
    <div className="ws">
      <aside className="ws-side">
        <div className="ws-brand">
          <Link href="/">LADING</Link>
          <span className="label">Freight credit operations</span>
        </div>

        <nav className="ws-nav">
          {NAV.map((g) => (
            <div className="ws-group" key={g.group}>
              <span className="label">{g.group}</span>
              {g.items.map((i) => {
                const badge =
                  i.id === "queue" && queue.length ? String(queue.length) :
                  i.id === "portfolio" && ops.positions.length ? String(ops.positions.length) : "";
                return (
                  <button
                    key={i.id}
                    className={screen === i.id ? "ws-link on" : "ws-link"}
                    onClick={() => go(i.id)}
                    aria-current={screen === i.id}
                  >
                    <span>{i.label}</span>
                    {badge && <span className="ws-badge">{badge}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="ws-foot">
          <NetworkSwitch />
          <div>BLOCK {ops.block.toString()}</div>
          <div>{isDeployed ? (ops.error ? "READ ERROR" : "READS LIVE") : "ADDRESSES UNSET"}</div>
        </div>
      </aside>

      <main className="ws-main">
        <header className="ws-bar">
          <div className="ws-title">
            <h1>{TITLES[screen]}</h1>
            <span className="num">
              {screen === "case" && selected !== null
                ? bolRef(ops.positions.find((x) => x.id === selected)?.docHash)
                : "LADING / CREDIT OPERATIONS"}
            </span>
          </div>

          <button className="ws-search" onClick={() => setPalette(true)}>
            <span>Search assets, obligors, screens</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div className="ws-right">
            <NetworkBadge />
            <span className="ws-stat">
              <span className="label">TVL</span>
              <b>{usd(ops.pool.total)}</b>
            </span>
            <span className="ws-stat">
              <span className="label">tUSD</span>
              <b>{isConnected ? usd(balance) : "--"}</b>
            </span>
            {queue.length > 0 && (
              <button className="ws-alerts" onClick={() => go("queue")}>
                ALERTS <b>{String(queue.length).padStart(2, "0")}</b>
              </button>
            )}
            <Wallet />
          </div>
        </header>

        <div className="ws-body">
          {ops.error && (
            <p className="callout"><b>Chain read failed.</b> {ops.error}</p>
          )}
          {!isDeployed && (
            <p className="callout">
              <b>Contract addresses are not configured in this build.</b> Set the four
              NEXT_PUBLIC_ addresses and every screen fills from chain.
            </p>
          )}
          {ops.loading && isDeployed && <p className="callout">Reading protocol state&hellip;</p>}
          {!isConnected && isDeployed && (
            <p className="callout">
              <b>Connect a wallet on chain {IS_TESTNET ? "968" : "677"} to operate.</b> Reads are
              live without one; every write needs a signer.
            </p>
          )}
          {/*
            An unseeded book is not a broken screen, but it does look like one
            if nothing says otherwise. This states the position plainly and
            sends the visitor to the deployment that is actually running rather
            than leaving them to conclude the protocol does nothing.
          */}
          {isDeployed && !ops.loading && ops.positions.length === 0 && !IS_TESTNET && (
            <p className="callout">
              <b>No receivable has been registered on mainnet yet.</b> The contracts are live and
              immutable at the addresses above; LADING settles in bridged USDT, which it does not
              issue, so the book stays empty until capital is bridged to it.{" "}
              <button className="linkish" onClick={() => switchNetwork("testnet")}>
                Switch to testnet
              </button>{" "}
              to watch the same contracts run a financed load, a contested slot and a load nobody
              would bid on.
            </p>
          )}
          {body()}
        </div>
      </main>

      <Overlay open={palette} onClose={() => setPalette(false)}>
        <input
          className="pal-input"
          autoFocus
          placeholder="Search assets, obligors, screens..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="pal-list">
          {results.length === 0 && <li className="pal-empty">No match.</li>}
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button
                onClick={() =>
                  r.kind === "asset" ? go("case", r.id as bigint) : go(r.id as string)
                }
              >
                <span>{r.label}</span>
                <span className="pal-hint">{r.hint}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="pal-foot label">
          {address ? shortAddress(address) : "not connected"} ·{" "}
          {addresses.market ? shortAddress(addresses.market) : "market pending"}
        </div>
      </Overlay>

    </div>
  );
}
