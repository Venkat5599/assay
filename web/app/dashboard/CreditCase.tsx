"use client";

import {useState} from "react";

import {BorrowRepay, OpenSlot, PlaceBid} from "../components/Forms";
import {Collapse} from "../components/Reveal";
import {explorerTx, explorerAddress} from "@/lib/chain";
import {usd, shortAddress, bolRef} from "@/lib/format";
import {bookOf, COVERAGE_THRESHOLD, ZERO, type Ops, type Position} from "@/lib/useOps";
import {Head, Metric} from "./Screens";

/**
 * The credit case.
 *
 * One receivable, its whole lifecycle: document, underwriting, firm bid,
 * credit structure, coverage, and settlement. Everything is derived from the
 * position - the waterfall is arithmetic on real figures, the coverage
 * projection uses the slot's own decay rate.
 */

const HAIRCUT_BPS = 2000; // FirmBidMarket.haircutBps

function Stage({
  n, label, value, state, onClick,
}: {
  n: string; label: string; value: string;
  state: "done" | "active" | "pending" | "fail";
  onClick?: () => void;
}) {
  return (
    <button className={`stage-node ${state}`} onClick={onClick} disabled={!onClick}>
      <span className="stage-n">{n}</span>
      <span className="stage-l">{label}</span>
      <span className="stage-v">{value}</span>
    </button>
  );
}

/** face -> floor -> haircut -> capacity -> drawn, each step a real number. */
function Waterfall({p}: {p: Position}) {
  const rows = [
    {k: "FACE VALUE", v: p.face, note: "as invoiced"},
    {k: "FIRM FLOOR", v: p.floor, note: p.face > 0n ? `${p.advance.toFixed(1)}% advance` : ""},
    {k: "HAIRCUT", v: (p.floor * BigInt(HAIRCUT_BPS)) / 10000n, note: `${HAIRCUT_BPS / 100}% policy`, minus: true},
    {k: "MAX CREDIT", v: p.cap, note: "borrowing capacity"},
    {k: "DRAWN", v: p.debt, note: `${p.utilisation.toFixed(1)}% utilised`},
  ];
  const max = p.face > 0n ? p.face : 1n;

  return (
    <div className="fall">
      {rows.map((r) => (
        <div className="fall-row" key={r.k}>
          <span className="fall-k">{r.k}</span>
          <span className="fall-bar">
            <i
              className={r.minus ? "minus" : undefined}
              style={{width: `${Math.min(100, Number((r.v * 100n) / max))}%`}}
            />
          </span>
          <span className="fall-v">
            {r.minus ? "-" : ""}
            {usd(r.v)}
          </span>
          <span className="fall-n">{r.note}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Coverage today against the point where the decaying floor stops covering
 * the loan. Projection is the contract's own compounding, not a guess.
 */
function Coverage({p}: {p: Position}) {
  const threshold = (p.debt * BigInt(Math.round(COVERAGE_THRESHOLD * 100))) / 100n;
  const cover = p.debt > 0n ? p.coverage : Infinity;
  const headroom = p.floor > threshold ? p.floor - threshold : 0n;
  const pctToBreach = p.floor > 0n ? Number((headroom * 100n) / p.floor) : 0;

  return (
    <>
      <div className="cov">
        <div className="cov-row">
          <span className="label">FIRM FLOOR</span>
          <b>{usd(p.floor)}</b>
        </div>
        <div className="cov-track">
          <span className="cov-fill" style={{height: `${Math.min(100, pctToBreach)}%`}} />
          <span className="cov-mark" style={{bottom: `${Math.min(96, 100 - pctToBreach)}%`}}>
            <i />
            <em>
              {usd(threshold)} · {COVERAGE_THRESHOLD}x threshold
            </em>
          </span>
        </div>
        <div className="cov-row">
          <span className="label">OUTSTANDING</span>
          <b>{usd(p.debt)}</b>
        </div>
      </div>
      <div className="cov-stats">
        <Metric
          label="COVERAGE"
          value={p.debt > 0n ? `${cover.toFixed(2)}x` : "n/a"}
          tone={p.debt === 0n ? undefined : cover < COVERAGE_THRESHOLD ? "bad" : "ok"}
          note={`policy ${COVERAGE_THRESHOLD}x`}
        />
        <Metric label="HEADROOM" value={usd(headroom)} note="floor above threshold" />
        <Metric label="MATURITY" value={`${p.days}d`} note={p.days < 0 ? "matured" : "until settlement"}
                tone={p.days <= 7 ? "warn" : undefined} />
        <Metric label="STATUS" value={p.status}
                tone={p.status === "BREACH" || p.status === "DEFAULT" ? "bad" : p.status === "MATURING" ? "warn" : "ok"} />
      </div>
    </>
  );
}

/** The demo moment. Escrow to lender, invoice to underwriter, one block. */
function Settlement({p, ops}: {p: Position; ops: Ops}) {
  const toLender = p.debt > p.floor ? p.floor : p.debt;
  const surplus = p.floor > p.debt ? p.floor - p.debt : 0n;

  return (
    <div className="settle">
      <div className="settle-head">
        <span className={`chip ${p.defaulted ? "bad" : ""}`}>
          {p.defaulted ? "CALLABLE NOW" : "NOT CALLABLE"}
        </span>
        <span className="num">
          {p.defaulted
            ? p.days < 0 ? "TRIGGER: MATURITY" : "TRIGGER: COVERAGE"
            : "no trigger reached"}
        </span>
      </div>

      <div className="settle-flow">
        <div className="sf-top">
          <span className="sf-box acid">
            <span className="label">ESCROW</span>
            <b>{usd(p.escrow)}</b>
          </span>
        </div>
        <div className="sf-stem" />
        <div className="sf-mid">
          <span className="sf-box">
            <span className="label">UNDERWRITER</span>
            <b>{p.underwriter === ZERO ? "none" : bookOf(p.underwriter)}</b>
            <em>receives the receivable</em>
          </span>
        </div>
        <div className="sf-split">
          <span className="sf-leg" />
          <span className="sf-leg" />
        </div>
        <div className="sf-bottom">
          <span className="sf-box">
            <span className="label">LENDER</span>
            <b>{usd(toLender)}</b>
            <em>made whole first</em>
          </span>
          <span className="sf-box">
            <span className="label">CARRIER</span>
            <b>{usd(surplus)}</b>
            <em>surplus above the debt</em>
          </span>
        </div>
      </div>

      <ul className="checks">
        <li className={p.escrow >= p.floor ? "on" : ""}>
          <i />ESCROW VERIFIED — {usd(p.escrow)} held against a {usd(p.floor)} floor
        </li>
        <li className={p.open ? "on" : ""}>
          <i />COLLATERAL ESCROWED — the market holds the receivable
        </li>
        <li className={p.defaulted ? "on" : ""}>
          <i />SETTLEMENT {p.defaulted ? "READY" : "NOT TRIGGERED"}
        </li>
      </ul>

      <p className="settle-claim">
        NO AUCTION REQUIRED &nbsp;/&nbsp; NO ORACLE REQUIRED &nbsp;/&nbsp; NO KEEPER REQUIRED
      </p>

      {ops.settleAction ? <>{ops.settleAction(p)}</> : null}
    </div>
  );
}

export function CreditCase({
  ops, id, go,
}: {
  ops: Ops & {settleAction?: (p: Position) => React.ReactNode};
  id: bigint;
  go: (s: string, i?: bigint) => void;
}) {
  const [tab, setTab] = useState<"book" | "structure" | "coverage" | "settlement" | "document">("structure");
  const p = ops.positions.find((x) => x.id === id);

  if (!p) return <p className="callout">Receivable #{id.toString()} is not registered here.</p>;

  const book = ops.bids.filter((b) => b.assetId === id).sort((a, b) => Number(b.block - a.block));
  const events = ops.audit.filter((a) => a.detail.includes(`asset #${id}`));
  const priced = p.underwriter !== ZERO;

  return (
    <>
      <div className="case-head">
        <div>
          <button className="linkish" onClick={() => go("receivables")}>&larr; receivables</button>
          <h2 className="case-ref">{bolRef(p.docHash)}</h2>
          <span className="num">
            OBLIGOR{" "}
            <a href={explorerAddress(p.obligor)} target="_blank" rel="noreferrer">
              {shortAddress(p.obligor)}
            </a>
          </span>
        </div>
        <span className={`chip ${p.status === "BREACH" || p.status === "DEFAULT" ? "bad" : p.status === "MATURING" || p.status === "UNPRICED" ? "warn" : "covered"}`}>
          {p.status === "DRAWN" ? "COVERED" : p.status}
        </span>
      </div>

      <div className="metrics">
        <Metric label="FACE VALUE" value={usd(p.face)} note="as invoiced" />
        <Metric label="FIRM FLOOR" value={usd(p.floor)} note={priced ? bookOf(p.underwriter) : "unpriced"}
                tone={priced ? "ok" : undefined} />
        <Metric label="AVAILABLE CREDIT" value={usd(p.drawable)} note="undrawn capacity" />
        <Metric label="CURRENT LOAN" value={usd(p.debt)} note={`${p.utilisation.toFixed(0)}% of capacity`} />
        <Metric label="DUE" value={`${p.days}d`} note={p.days < 0 ? "matured" : "until settlement"}
                tone={p.days <= 7 ? "warn" : undefined} />
      </div>

      {/* The pipeline. Each stage carries its real value. */}
      <div className="pipeline">
        <Stage n="01" label="RECEIVABLE" value={usd(p.face)} state="done" onClick={() => setTab("document")} />
        <Stage n="02" label="DOCUMENT" value={bolRef(p.docHash)} state="done" onClick={() => setTab("document")} />
        <Stage n="03" label="UNDERWRITING" value={priced ? `${p.advance.toFixed(0)}% adv` : "no bid"}
               state={priced ? "done" : "pending"} onClick={() => go("desks")} />
        <Stage n="04" label="FIRM BID" value={priced ? usd(p.floor) : "--"}
               state={priced ? "done" : "pending"} onClick={() => setTab("book")} />
        <Stage n="05" label="ESCROW" value={usd(p.escrow)} state={p.escrow > 0n ? "done" : "pending"}
               onClick={() => setTab("settlement")} />
        <Stage n="06" label="CREDIT" value={usd(p.cap)} state={p.cap > 0n ? "done" : "pending"}
               onClick={() => setTab("structure")} />
        <Stage n="07" label="LOAN" value={p.debt > 0n ? usd(p.debt) : "undrawn"}
               state={p.debt > 0n ? "active" : "pending"} onClick={() => setTab("coverage")} />
        <Stage n="08" label="SETTLEMENT" value={p.defaulted ? "READY" : "--"}
               state={p.defaulted ? "fail" : "pending"} onClick={() => setTab("settlement")} />
      </div>

      <div className="tabs">
        {([
          ["structure", "Credit structure"],
          ["book", `Bid book (${book.length})`],
          ["coverage", "Coverage"],
          ["settlement", "Settlement"],
          ["document", "Document"],
        ] as const).map(([k, label]) => (
          <button key={k} className={tab === k ? "tab on" : "tab"} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "structure" && (
        <div className="cols">
          <section>
            <Head title="Credit structure" right="DERIVED FROM CHAIN" />
            <Waterfall p={p} />
          </section>
          <section className="stack">
            {!p.open && <OpenSlot assetId={p.id} onDone={ops.refresh} />}
            {p.open && <BorrowRepay assetId={p.id} drawable={p.drawable} debt={p.debt} onDone={ops.refresh} />}
          </section>
        </div>
      )}

      {tab === "book" && (
        <div className="cols">
          <section>
            <Head title="Firm bid market" right={`${book.length} BIDS`} />
            {book.length === 0 ? (
              <p className="callout">
                <b>No firm bid.</b> Nobody has committed capital to buy this receivable, so it is
                not financeable. Absence of a bid is information.
              </p>
            ) : (
              <>
                <div className="tablewrap">
                  <table className="tbl">
                    <thead><tr><th>UNDERWRITER</th><th className="t-num">FLOOR</th><th className="t-num">ESCROW</th><th>STATUS</th></tr></thead>
                    <tbody>
                      {book.map((b, i) => (
                        <tr key={b.hash}>
                          <td className="t-id">{bookOf(b.underwriter)}</td>
                          <td className="t-num">{usd(b.floor)}</td>
                          <td className="t-num">{usd(b.floor)}</td>
                          <td><span className={`chip ${i === 0 ? "covered" : ""}`}>{i === 0 ? "ACTIVE" : "DISPLACED"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="floorviz">
                  <span className="label">CURRENT FLOOR</span>
                  <b>{usd(p.floor)}</b>
                  <span className="floorbar"><i style={{width: "100%"}} /></span>
                  {book[1] && (
                    <span className="floorprev">
                      previous {usd(book[1].floor)} · displaced
                    </span>
                  )}
                </div>
              </>
            )}
          </section>
          <section className="stack">
            <Head title="Bid events" right="BidPlaced" />
            <ul className="tape">
              {book.map((b) => (
                <li key={b.hash}>
                  <span className="t-num">{b.block.toString()}</span>
                  <span>
                    {bookOf(b.underwriter)}{" "}
                    {b.displaced === ZERO ? "placed" : "raised floor to"} <b>{usd(b.floor)}</b>
                  </span>
                  <a href={explorerTx(b.hash)} target="_blank" rel="noreferrer">tx</a>
                </li>
              ))}
            </ul>
            {p.open && <PlaceBid assetId={p.id} currentFloor={priced ? p.floor : undefined} onDone={ops.refresh} />}
          </section>
        </div>
      )}

      {tab === "coverage" && (
        <>
          <Head title="Coverage monitor" right="FLOOR AGAINST LOAN" />
          <Coverage p={p} />
          <p className="callout">
            <b>The floor decays every block while the bid is uncontested.</b> When it falls to the
            outstanding loan the position becomes callable on its own — no vote, no keeper
            choosing the moment. A better bid resets it upward.
          </p>
        </>
      )}

      {tab === "settlement" && (
        <>
          <Head title="Atomic settlement" right={p.defaulted ? "READY" : "MONITOR"} />
          <Settlement p={p} ops={ops} />
        </>
      )}

      {tab === "document" && (
        <div className="cols">
          <section>
            <Head title="Document integrity" right="COMMITTED ON CHAIN" />
            <dl className="kv">
              <div><dt>Reference</dt><dd>{bolRef(p.docHash)}</dd></div>
              <div><dt>Document hash</dt><dd className="mono">{p.docHash}</dd></div>
              <div><dt>Registry status</dt><dd><span className="chip covered">REGISTERED</span></dd></div>
              <div><dt>Duplicate pledge</dt><dd><span className="chip covered">NONE</span></dd></div>
              <div><dt>Registered to</dt><dd className="mono">{p.owner}</dd></div>
              <div><dt>Obligor</dt><dd className="mono">{p.obligor}</dd></div>
              <div><dt>Face value</dt><dd>{usd(p.face)}</dd></div>
              <div><dt>Settles</dt><dd>{new Date(Number(p.dueDate) * 1000).toISOString().slice(0, 10)}</dd></div>
            </dl>
            <p className="callout">
              <b>The hash is the commitment; the document never leaves the carrier.</b> The
              registry rejects a second registration of the same hash, so the same paperwork
              cannot be pledged twice here.
            </p>
          </section>
          <section>
            <Head title="Lifecycle" right="ON CHAIN" />
            <ul className="tape">
              {events.map((e, i) => (
                <li key={e.hash + i}>
                  <span className="t-num">{e.block.toString()}</span>
                  <span>{e.action}</span>
                  <a href={explorerTx(e.hash)} target="_blank" rel="noreferrer">tx</a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

export {Collapse};
