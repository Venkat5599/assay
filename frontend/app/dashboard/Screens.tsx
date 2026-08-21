"use client";

import {useMemo, useState} from "react";

import {GetUsdt, LendPanel, PlaceBid, SubmitLoad} from "../components/Forms";
import {ClaimSurplus, WithdrawPanel} from "../components/Exits";
import {RegisterCounterparty, SetCounterpartyStatus} from "../components/Counterparty";
import {addresses} from "@/lib/addresses";
import {explorerAddress, explorerTx} from "@/lib/chain";
import {usd, shortAddress, bolRef} from "@/lib/format";
import {nameOf, useOntology} from "@/lib/useOntology";
import {
  bookOf, COVERAGE_THRESHOLD, useDesks, usePortfolio, useWorkQueue, ZERO,
  type Ops, type Position,
} from "@/lib/useOps";

/* ------------------------------------------------------------------ atoms */

export function Metric({
  label, value, note, tone,
}: {
  label: string; value: string; note?: string; tone?: "ok" | "warn" | "bad";
}) {
  return (
    <div className="metric">
      <span className="label">{label}</span>
      <div className={`metric-v${tone ? ` ${tone}` : ""}`}>{value}</div>
      {note && <div className="metric-n">{note}</div>}
    </div>
  );
}

export function Head({title, right}: {title: string; right?: React.ReactNode}) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      {right && <span className="num">{right}</span>}
    </div>
  );
}

const toneFor = (s: Position["status"]) =>
  s === "DEFAULT" || s === "BREACH" ? "bad" : s === "MATURING" || s === "UNPRICED" ? "warn" : "ok";

function Bar({value, tone}: {value: number; tone?: string}) {
  return (
    <span className={`meter${tone ? ` ${tone}` : ""}`}>
      <i style={{width: `${Math.min(Math.max(value, 0), 100)}%`}} />
    </span>
  );
}

function Empty({children}: {children: React.ReactNode}) {
  return <p className="callout">{children}</p>;
}

/* --------------------------------------------------------- command center */

export function CommandCenter({ops, go}: {ops: Ops; go: (s: string, id?: bigint) => void}) {
  const p = usePortfolio(ops.positions);
  const queue = useWorkQueue(ops.positions);
  const counts = {
    open: ops.positions.filter((x) => x.open).length,
    review: queue.filter((q) => q.type === "UNDERWRITE").length,
    maturing: ops.positions.filter((x) => x.status === "MATURING").length,
    breach: ops.positions.filter((x) => x.status === "BREACH").length,
    default: ops.positions.filter((x) => x.status === "DEFAULT").length,
  };

  return (
    <>
      <div className="metrics">
        <Metric label="PORTFOLIO" value={usd(p.face)} note="registered face value" />
        <Metric label="OUTSTANDING" value={usd(p.debt)} note={`${p.ltv.toFixed(1)}% of face`} />
        <Metric label="AVAILABLE LIQUIDITY" value={usd(ops.pool.idle)} note="undeployed in the vault" />
        <Metric
          label="COVERAGE"
          value={p.debt > 0n ? `${p.coverage.toFixed(1)}%` : "n/a"}
          note="firm floors over debt"
          tone={p.debt > 0n && p.coverage < 120 ? "warn" : "ok"}
        />
        <Metric label="AT RISK" value={usd(p.atRisk)} note="breach or default" tone={p.atRisk > 0n ? "bad" : "ok"} />
      </div>

      <Head title="Credit operations" right={`BLOCK ${ops.block}`} />
      <div className="ops-strip">
        {([
          ["OPEN", counts.open, undefined],
          ["REVIEW", counts.review, counts.review ? "warn" : undefined],
          ["MATURING", counts.maturing, counts.maturing ? "warn" : undefined],
          ["BREACH", counts.breach, counts.breach ? "bad" : undefined],
          ["DEFAULT", counts.default, counts.default ? "bad" : undefined],
        ] as const).map(([k, v, tone]) => (
          <button key={k} className="ops-cell" onClick={() => go("queue")}>
            <span className={`ops-n${tone ? ` ${tone}` : ""}`}>{String(v).padStart(2, "0")}</span>
            <span className="label">{k}</span>
          </button>
        ))}
      </div>

      <div className="cols">
        <section>
          <Head title="Requires action" right={`${queue.length} ITEMS`} />
          {queue.length === 0 ? (
            <Empty>
              <b>Nothing requires action.</b> No coverage breach, no maturity inside{" "}
              {COVERAGE_THRESHOLD === 1.2 ? "policy" : "window"}, and every open slot is priced.
            </Empty>
          ) : (
            <div className="tablewrap">
              <table className="tbl">
                <thead>
                  <tr><th>PRI</th><th>ASSET</th><th>TYPE</th><th>DESK</th><th>DETAIL</th></tr>
                </thead>
                <tbody>
                  {queue.slice(0, 8).map((q, i) => (
                    <tr key={`${q.id}-${q.type}-${i}`} onClick={() => go("case", q.id)}>
                      <td><span className={`chip ${q.priority.toLowerCase()}`}>{q.priority}</span></td>
                      <td className="t-id">{bolRef(q.position.docHash)}</td>
                      <td>{q.type}</td>
                      <td className="t-dim">{q.desk}</td>
                      <td className="t-dim">{q.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <Head title="Recent activity" right="EVERY ROW IS A TRANSACTION" />
          {ops.audit.length === 0 ? (
            <Empty>No protocol events yet on this deployment.</Empty>
          ) : (
            <div className="tablewrap">
              <table className="tbl">
                <thead>
                  <tr><th>BLOCK</th><th>ACTION</th><th>ACTOR</th><th>VERIFY</th></tr>
                </thead>
                <tbody>
                  {ops.audit.slice(0, 8).map((a) => (
                    <tr key={a.hash + a.action}>
                      <td className="t-id">{a.block.toString()}</td>
                      <td>{a.action}</td>
                      <td className="t-dim">{bookOf(a.actor)}</td>
                      <td>
                        <a
                          className="verify"
                          href={explorerTx(a.hash)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.hash.slice(0, 10)}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- work queue */

export function WorkQueue({ops, go}: {ops: Ops; go: (s: string, id?: bigint) => void}) {
  const queue = useWorkQueue(ops.positions);
  return (
    <>
      <Head title="Work queue" right={`${queue.length} OPEN ITEMS`} />
      {queue.length === 0 ? (
        <Empty><b>Queue is clear.</b> Nothing on this deployment requires an operator decision.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr><th>PRIORITY</th><th>ASSET</th><th>TYPE</th><th>DESK</th><th>DETAIL</th><th className="t-num">DUE</th></tr>
            </thead>
            <tbody>
              {queue.map((q, i) => (
                <tr key={`${q.id}-${q.type}-${i}`} onClick={() => go("case", q.id)}>
                  <td><span className={`chip ${q.priority.toLowerCase()}`}>{q.priority}</span></td>
                  <td className="t-id">{bolRef(q.position.docHash)}</td>
                  <td>{q.type}</td>
                  <td className="t-dim">{q.desk}</td>
                  <td className="t-dim">{q.detail}</td>
                  <td className="t-num">{q.position.days}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- portfolio */

export function Portfolio({ops, go}: {ops: Ops; go: (s: string, id?: bigint) => void}) {
  const p = usePortfolio(ops.positions);
  const {entities} = useOntology();
  return (
    <>
      <div className="metrics">
        <Metric label="TOTAL FACE VALUE" value={usd(p.face)} />
        <Metric label="OUTSTANDING CREDIT" value={usd(p.debt)} />
        <Metric label="FIRM FLOORS" value={usd(p.floors)} note="capital escrowed" />
        <Metric label="AVAILABLE CREDIT" value={usd(p.available)} />
        <Metric label="WEIGHTED LTV" value={`${p.ltv.toFixed(1)}%`} note="debt over face" />
        <Metric label="WEIGHTED MATURITY" value={`${Math.round(p.weightedDays)}d`} note="face-weighted" />
      </div>

      <Head title="Receivables" right={`${ops.positions.length} REGISTERED`} />
      {ops.positions.length === 0 ? (
        <Empty><b>No receivables registered.</b> Origination has not started on this deployment.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>REFERENCE</th><th>OBLIGOR</th><th className="t-num">FACE</th>
                <th className="t-num">FLOOR</th><th className="t-num">CREDIT</th>
                <th className="t-num">DRAWN</th><th className="t-num">COVER</th>
                <th className="t-num">DUE</th><th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {ops.positions.map((x) => (
                <tr key={x.id.toString()} onClick={() => go("case", x.id)}>
                  <td className="t-id">{bolRef(x.docHash)}</td>
                  <td className="t-dim">{nameOf(entities, x.obligor) ?? shortAddress(x.obligor)}</td>
                  <td className="t-num">{usd(x.face)}</td>
                  <td className="t-num">{usd(x.floor)}</td>
                  <td className="t-num">{usd(x.cap)}</td>
                  <td className="t-num">{usd(x.debt)}</td>
                  <td className={`t-num${x.debt > 0n && x.coverage < 1.2 ? " bad" : ""}`}>
                    {x.debt > 0n ? `${x.coverage.toFixed(2)}x` : "--"}
                  </td>
                  <td className="t-num">{x.days}d</td>
                  <td>
                    <span className={`chip ${x.status === "DRAWN" ? "covered" : toneFor(x.status)}`}>
                      {x.status === "DRAWN" ? "COVERED" : x.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- exposure */

export function Exposure({ops}: {ops: Ops}) {
  const p = usePortfolio(ops.positions);
  const {entities} = useOntology();

  // Risk band by coverage, which is the only risk signal the chain actually
  // carries. Grades and confidence scores are agent-side and not on chain.
  const matrix = useMemo(() => {
    const band = (x: Position) =>
      x.status === "DEFAULT" || x.status === "BREACH" ? 2 : x.debt === 0n || x.coverage >= 1.5 ? 0 : 1;
    const map = new Map<string, [bigint, bigint, bigint]>();
    for (const x of ops.positions) {
      const row = map.get(x.obligor) ?? [0n, 0n, 0n];
      row[band(x)] += x.face;
      map.set(x.obligor, row);
    }
    return [...map.entries()].sort((a, b) =>
      Number(b[1].reduce((s, v) => s + v, 0n) - a[1].reduce((s, v) => s + v, 0n)),
    );
  }, [ops.positions]);

  return (
    <>
      <Head title="Exposure by counterparty" right="BY OBLIGOR ADDRESS" />
      {p.exposure.length === 0 ? (
        <Empty>No exposure. Nothing is registered.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead><tr><th>OBLIGOR</th><th className="t-num">EXPOSURE</th><th className="t-num">SHARE</th><th>CONCENTRATION</th></tr></thead>
            <tbody>
              {p.exposure.map((e) => (
                <tr key={e.addr}>
                  <td className="t-id">{nameOf(entities, e.addr) ?? shortAddress(e.addr)}</td>
                  <td className="t-num">{usd(e.amount)}</td>
                  <td className="t-num">{e.share.toFixed(1)}%</td>
                  <td><Bar value={e.share} tone={e.share > 40 ? "bad" : e.share > 25 ? "warn" : undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Head title="Exposure matrix" right="FACE BY COVERAGE BAND" />
      {matrix.length === 0 ? (
        <Empty>Nothing to band.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead><tr><th>OBLIGOR</th><th className="t-num">LOW RISK</th><th className="t-num">MEDIUM</th><th className="t-num">HIGH</th></tr></thead>
            <tbody>
              {matrix.map(([addr, [lo, mid, hi]]) => (
                <tr key={addr}>
                  <td className="t-id">{nameOf(entities, addr) ?? shortAddress(addr)}</td>
                  <td className="t-num">{lo > 0n ? usd(lo) : "--"}</td>
                  <td className={`t-num${mid > 0n ? " warn" : ""}`}>{mid > 0n ? usd(mid) : "--"}</td>
                  <td className={`t-num${hi > 0n ? " bad" : ""}`}>{hi > 0n ? usd(hi) : "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Head title="Exposure by maturity" right="FACE VALUE" />
      <div className="tablewrap">
        <table className="tbl">
          <thead><tr><th>BUCKET</th><th className="t-num">FACE</th><th>SHARE</th></tr></thead>
          <tbody>
            {p.buckets.map((b) => (
              <tr key={b.label}>
                <td className="t-id">{b.label}</td>
                <td className="t-num">{usd(b.amount)}</td>
                <td><Bar value={p.face > 0n ? Number((b.amount * 10000n) / p.face) / 100 : 0} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ risk monitor */

export function RiskMonitor({ops}: {ops: Ops}) {
  const p = usePortfolio(ops.positions);
  const top = p.exposure[0];
  const concentration = top?.share ?? 0;
  const maturing = ops.positions.filter((x) => x.status === "MATURING" || x.days < 0).length;
  const unpriced = ops.positions.filter((x) => x.open && x.underwriter === ZERO).length;
  const util = p.cap > 0n ? Number((p.debt * 10000n) / p.cap) / 100 : 0;

  const health = ops.positions.length
    ? Math.max(0, 100 - concentration / 2 - (maturing * 8) - (unpriced * 5) - Math.max(0, util - 80))
    : 100;

  const rows = [
    {k: "COVERAGE", v: p.debt > 0n ? `${p.coverage.toFixed(1)}%` : "n/a", t: p.debt > 0n && p.coverage < 120 ? "warn" : "ok"},
    {k: "CONCENTRATION", v: `${concentration.toFixed(1)}%`, t: concentration > 40 ? "bad" : concentration > 25 ? "warn" : "ok"},
    {k: "MATURITY RISK", v: maturing ? `${maturing} INSIDE WINDOW` : "LOW", t: maturing ? "warn" : "ok"},
    {k: "PRICING RISK", v: unpriced ? `${unpriced} UNPRICED` : "LOW", t: unpriced ? "warn" : "ok"},
    {k: "UTILISATION", v: `${util.toFixed(1)}%`, t: util > 90 ? "warn" : "ok"},
    {k: "LIQUIDITY", v: usd(ops.pool.idle), t: ops.pool.idle === 0n ? "warn" : "ok"},
  ];

  return (
    <>
      <Head title="Portfolio health" right="DERIVED FROM CHAIN STATE" />
      <div className="health">
        <Bar value={health} tone={health < 60 ? "bad" : health < 80 ? "warn" : undefined} />
        <b>{health.toFixed(1)}%</b>
      </div>

      <div className="tablewrap">
        <table className="tbl">
          <thead><tr><th>SIGNAL</th><th>READING</th><th>STATE</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k}>
                <td className="t-id">{r.k}</td>
                <td className="t-num">{r.v}</td>
                <td><span className={`chip ${r.t}`}>{r.t === "ok" ? "NORMAL" : r.t === "warn" ? "ATTENTION" : "BREACH"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Head title="Watchlist" right="AUTOMATIC" />
      {(() => {
        const items = [
          ...ops.positions.filter((x) => x.status === "BREACH").map((x) => ({id: x.id, why: `coverage ${x.coverage.toFixed(2)}x below policy`})),
          ...ops.positions.filter((x) => x.status === "MATURING").map((x) => ({id: x.id, why: `settles in ${x.days} days`})),
          ...ops.positions.filter((x) => x.open && x.underwriter === ZERO).map((x) => ({id: x.id, why: "no firm bid"})),
          ...(concentration > 25 && top ? [{id: null, why: `obligor ${shortAddress(top.addr)} holds ${concentration.toFixed(1)}% of face`}] : []),
        ];
        return items.length === 0 ? (
          <Empty>Nothing on the watchlist.</Empty>
        ) : (
          <ul className="watch">
            {items.map((w, i) => (
              <li key={i}>
                <span className="dot" aria-hidden="true" />
                <b>{w.id === null ? "CONCENTRATION" : `ASSET #${w.id}`}</b>
                <span>{w.why}</span>
              </li>
            ))}
          </ul>
        );
      })()}
    </>
  );
}

/* -------------------------------------------------------------- bid book */

export function BidBook({ops, selected, go}: {ops: Ops; selected: bigint | null; go: (s: string, id?: bigint) => void}) {
  const pos = ops.positions.find((x) => x.id === selected) ?? ops.positions[0];
  if (!pos) return <Empty>No receivables to price.</Empty>;

  const book = ops.bids.filter((b) => b.assetId === pos.id).sort((a, b) => Number(a.block - b.block));

  return (
    <>
      <Head title={`Firm bid market · asset #${pos.id}`} right={`FACE ${usd(pos.face)}`} />
      <div className="metrics">
        <Metric label="CURRENT FLOOR" value={usd(pos.floor)} note="escrowed in full" />
        <Metric label="BORROWING CAPACITY" value={usd(pos.cap)} note="floor less haircut" />
        <Metric label="ADVANCE RATE" value={pos.advance ? `${pos.advance.toFixed(1)}%` : "--"} note="floor over face" />
        <Metric label="PREMIUM RESERVE" value={usd(pos.premiumReserve)} note="funds the standing bid" />
      </div>

      <Head title="Order book" right={`${book.length} BIDS`} />
      {book.length === 0 ? (
        <Empty><b>No bids.</b> Nobody has committed capital to buy this receivable.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead><tr><th>DESK</th><th className="t-num">FLOOR</th><th className="t-num">CAPITAL</th><th>ADDRESS</th><th className="t-num">BLOCK</th><th>STATE</th></tr></thead>
            <tbody>
              {[...book].reverse().map((b, i) => (
                <tr key={b.hash}>
                  <td className="t-id">{bookOf(b.underwriter)}</td>
                  <td className="t-num">{usd(b.floor)}</td>
                  <td className="t-num">{usd(b.floor)}</td>
                  <td className="t-dim">
                    <a href={explorerAddress(b.underwriter)} target="_blank" rel="noreferrer">
                      {shortAddress(b.underwriter)}
                    </a>
                  </td>
                  <td className="t-num">{b.block.toString()}</td>
                  <td><span className={`chip ${i === 0 ? "ok" : ""}`}>{i === 0 ? "HOLDS SLOT" : "DISPLACED"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Head title="Bid events" right="BidPlaced LOGS" />
      <ul className="tape">
        {[...book].reverse().map((b) => (
          <li key={b.hash}>
            <span className="t-num">{b.block.toString()}</span>
            <span>
              {bookOf(b.underwriter)}{" "}
              {b.displaced === ZERO ? "entered at" : "raised floor to"} <b>{usd(b.floor)}</b>
              {b.displaced !== ZERO && <> · displaced {bookOf(b.displaced)}</>}
            </span>
            <a href={explorerTx(b.hash)} target="_blank" rel="noreferrer">tx</a>
          </li>
        ))}
      </ul>

      <div className="cols">
        <PlaceBid assetId={pos.id} currentFloor={pos.underwriter !== ZERO ? pos.floor : undefined} onDone={ops.refresh} />
        <section>
          <Head title="Other assets" />
          <div className="tablewrap">
            <table className="tbl">
              <thead><tr><th>ASSET</th><th className="t-num">FLOOR</th><th>STATUS</th></tr></thead>
              <tbody>
                {ops.positions.map((x) => (
                  <tr key={x.id.toString()} className={x.id === pos.id ? "on" : undefined} onClick={() => go("bidbook", x.id)}>
                    <td className="t-id">{bolRef(x.docHash)}</td>
                    <td className="t-num">{usd(x.floor)}</td>
                    <td><span className={`chip ${toneFor(x.status)}`}>{x.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

/* -------------------------------------------------------- underwriting desk */

export function Underwriting({ops, go}: {ops: Ops; go: (s: string, id?: bigint) => void}) {
  return (
    <>
      <Head title="Underwriting desk" right={`${ops.positions.length} CASES`} />
      {ops.positions.length === 0 ? (
        <Empty>No cases.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr><th>CASE</th><th className="t-num">FACE</th><th className="t-num">FLOOR</th><th className="t-num">ADV</th><th>DESK</th><th className="t-num">TERM</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              {ops.positions.map((x) => (
                <tr key={x.id.toString()} onClick={() => go("case", x.id)}>
                  <td className="t-id">{bolRef(x.docHash)}</td>
                  <td className="t-num">{usd(x.face)}</td>
                  <td className="t-num">{x.floor > 0n ? usd(x.floor) : "--"}</td>
                  <td className="t-num">{x.advance ? `${x.advance.toFixed(0)}%` : "--"}</td>
                  <td className="t-dim">{x.underwriter === ZERO ? "--" : bookOf(x.underwriter)}</td>
                  <td className="t-num">{x.days}d</td>
                  <td>
                    <span className={`chip ${x.underwriter === ZERO ? "warn" : "ok"}`}>
                      {x.underwriter === ZERO ? "NO BID" : "APPROVED"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="callout">
        <b>Grades and confidence scores are agent-side, not on chain.</b> The registry commits the
        obligor, face value, due date and document hash. Everything shown here is derived from
        those four fields plus the escrowed bid, so nothing on this desk is a stated opinion the
        chain cannot back.
      </p>
    </>
  );
}

/* --------------------------------------------------------------- desks */

export function Desks({ops}: {ops: Ops}) {
  const desks = useDesks(ops.positions, ops.bids);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      <Head title="Underwriter agents" right={`${desks.length} ACTIVE`} />
      {desks.length === 0 ? (
        <Empty><b>No desk has bid yet.</b> Agents appear here once they commit capital.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr><th>DESK</th><th className="t-num">CAPITAL</th><th className="t-num">ESCROWED</th><th className="t-num">BIDS</th><th className="t-num">HOLDING</th><th className="t-num">DISPLACED</th><th className="t-num">AVG ADV</th><th>STATE</th></tr>
            </thead>
            <tbody>
              {desks.map((d) => (
                <tr key={d.address} className={open === d.address ? "on" : undefined}
                    onClick={() => setOpen(open === d.address ? null : d.address)}>
                  <td className="t-id">{d.name}</td>
                  <td className="t-num">{usd(d.capital)}</td>
                  <td className="t-num">{usd(d.escrowed)}</td>
                  <td className="t-num">{d.bidsPlaced}</td>
                  <td className="t-num">{d.holding}</td>
                  <td className="t-num">{d.displaced}</td>
                  <td className="t-num">{d.avgAdvance ? `${d.avgAdvance.toFixed(1)}%` : "--"}</td>
                  <td><span className="chip ok">ACTIVE</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (() => {
        const d = desks.find((x) => x.address === open)!;
        return (
          <>
            <Head title={`${d.name} · decision audit`} right={shortAddress(d.address)} />
            <div className="tablewrap">
              <table className="tbl">
                <thead><tr><th>ASSET</th><th className="t-num">FLOOR</th><th className="t-num">RATE</th><th className="t-num">BLOCK</th><th>TX</th></tr></thead>
                <tbody>
                  {d.events.map((e) => (
                    <tr key={e.hash}>
                      <td className="t-id">#{e.assetId.toString()}</td>
                      <td className="t-num">{usd(e.floor)}</td>
                      <td className="t-num">{(Number(e.premiumRate) / 1e15).toFixed(2)}</td>
                      <td className="t-num">{e.block.toString()}</td>
                      <td><a href={explorerTx(e.hash)} target="_blank" rel="noreferrer">view</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="callout">
              <b>The model grades; deterministic code prices.</b> The grade and its written
              rationale live in the agent process. What reaches the chain is the number the
              pricing kernel produced and the capital escrowed behind it &mdash; which is what
              these rows are.
            </p>
          </>
        );
      })()}
    </>
  );
}

/* ---------------------------------------------------------------- capital */

export function Funding({ops}: {ops: Ops}) {
  const util = ops.pool.total > 0n ? Number((ops.pool.deployed * 10000n) / ops.pool.total) / 100 : 0;
  return (
    <>
      <div className="metrics">
        <Metric label="TOTAL CAPITAL" value={usd(ops.pool.total)} note="idle plus lent" />
        <Metric label="DEPLOYED" value={usd(ops.pool.deployed)} note="outstanding to carriers" />
        <Metric label="AVAILABLE" value={usd(ops.pool.idle)} note="withdrawable" />
        <Metric label="UTILISATION" value={`${util.toFixed(1)}%`} tone={util > 90 ? "warn" : "ok"} />
      </div>
      <div className="cols">
        <LendPanel />
        <WithdrawPanel idle={ops.pool.idle} />
      </div>
      <div className="cols">
        <ClaimSurplus />
        <GetUsdt />
      </div>
    </>
  );
}

export function LoanBook({ops, go}: {ops: Ops; go: (s: string, id?: bigint) => void}) {
  const drawn = ops.positions.filter((x) => x.debt > 0n);
  return (
    <>
      <Head title="Loan book" right={`${drawn.length} OPEN LOANS`} />
      {drawn.length === 0 ? (
        <Empty><b>No credit drawn.</b> Every registered receivable is unfunded.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr><th>ASSET</th><th className="t-num">PRINCIPAL</th><th className="t-num">FLOOR</th><th className="t-num">COVER</th><th className="t-num">DUE</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              {drawn.map((x) => (
                <tr key={x.id.toString()} onClick={() => go("case", x.id)}>
                  <td className="t-id">{bolRef(x.docHash)}</td>
                  <td className="t-num">{usd(x.debt)}</td>
                  <td className="t-num">{usd(x.floor)}</td>
                  <td className={`t-num${x.coverage < COVERAGE_THRESHOLD ? " bad" : ""}`}>{x.coverage.toFixed(2)}x</td>
                  <td className="t-num">{x.days}d</td>
                  <td><span className={`chip ${toneFor(x.status)}`}>{x.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------- servicing */

export function Servicing({ops, go}: {ops: Ops; go: (s: string, id?: bigint) => void}) {
  const ready = ops.positions.filter((x) => x.defaulted);
  const monitor = ops.positions.filter((x) => !x.defaulted && (x.status === "BREACH" || x.status === "MATURING"));
  return (
    <>
      <Head title="Settlement operations" right={`${ready.length} READY`} />
      {ready.length + monitor.length === 0 ? (
        <Empty><b>Nothing in servicing.</b> No position is callable and none is inside the maturity window.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr><th>CASE</th><th>TRIGGER</th><th className="t-num">FLOOR</th><th className="t-num">LOAN</th><th className="t-num">SURPLUS</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              {[...ready, ...monitor].map((x) => (
                <tr key={x.id.toString()} onClick={() => go("case", x.id)}>
                  <td className="t-id">{bolRef(x.docHash)}</td>
                  <td>{x.defaulted ? (x.days < 0 ? "MATURITY" : "COVERAGE") : x.status === "BREACH" ? "COVERAGE" : "MATURITY"}</td>
                  <td className="t-num">{usd(x.floor)}</td>
                  <td className="t-num">{usd(x.debt)}</td>
                  <td className="t-num">{x.floor > x.debt ? usd(x.floor - x.debt) : "--"}</td>
                  <td><span className={`chip ${x.defaulted ? "bad" : "warn"}`}>{x.defaulted ? "READY" : "MONITOR"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ audit trail */

export function Audit({ops}: {ops: Ops}) {
  return (
    <>
      <Head title="Audit trail" right={`${ops.audit.length} EVENTS`} />
      {ops.audit.length === 0 ? (
        <Empty>No events on this deployment.</Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead><tr><th className="t-num">BLOCK</th><th>ACTOR</th><th>ACTION</th><th>CONTRACT</th><th>TX</th></tr></thead>
            <tbody>
              {ops.audit.map((a, i) => (
                <tr key={a.hash + i}>
                  <td className="t-num">{a.block.toString()}</td>
                  <td className="t-dim">{bookOf(a.actor)}</td>
                  <td className="t-id">{a.action}</td>
                  <td className="t-dim">{a.contract}</td>
                  <td><a href={explorerTx(a.hash)} target="_blank" rel="noreferrer">{a.hash.slice(0, 10)}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* --------------------------------------------------------------- protocol */

export function Protocol({ops}: {ops: Ops}) {
  const dupes = new Set<string>();
  const seen = new Set<string>();
  for (const p of ops.positions) {
    if (seen.has(p.docHash)) dupes.add(p.docHash);
    seen.add(p.docHash);
  }
  return (
    <>
      <Head title="Document integrity" right="ENFORCED AT REGISTRATION" />
      <div className="metrics">
        <Metric label="REGISTERED DOCUMENTS" value={String(ops.positions.length)} />
        <Metric label="UNIQUE HASHES" value={String(seen.size)} />
        <Metric label="DUPLICATES ACCEPTED" value={String(dupes.size)} tone={dupes.size ? "bad" : "ok"}
                note="the registry reverts on a repeat hash" />
        <Metric label="CHAIN HEIGHT" value={ops.block.toString()} />
      </div>

      <Head title="Contracts" right="BOT CHAIN" />
      <div className="tablewrap">
        <table className="tbl">
          <thead><tr><th>CONTRACT</th><th>ADDRESS</th><th>ROLE</th></tr></thead>
          <tbody>
            {([
              ["AssetRegistry", addresses.assetRegistry, "ERC-721 receivable record and hash uniqueness"],
              ["FirmBidMarket", addresses.market, "escrowed bids, contest, decay, settlement"],
              ["LoanVault", addresses.vault, "pooled credit, interest, default triggers"],
              ["TestStable", addresses.stable, "settlement token (testnet, openly mintable)"],
            ] as const).map(([n, a, role]) => (
              <tr key={n}>
                <td className="t-id">{n}</td>
                <td className="t-dim">
                  {a ? <a href={explorerAddress(a)} target="_blank" rel="noreferrer">{a}</a> : "pending"}
                </td>
                <td className="t-dim">{role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Origination({ops}: {ops: Ops}) {
  return (
    <div className="cols">
      <SubmitLoad onDone={ops.refresh} />
      <GetUsdt />
    </div>
  );
}


/* --------------------------------------------------------- counterparties */

export function Counterparties() {
  const [key, setKey] = useState(0);
  const {list} = useOntology(key);
  const refresh = () => setKey((n) => n + 1);

  return (
    <>
      <Head title="Counterparties" right={`${list.length} ON CHAIN`} />
      {list.length === 0 ? (
        <Empty>
          <b>No counterparties recorded.</b> The registry is deployed but empty, so obligors
          render as addresses.
        </Empty>
      ) : (
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>ENTITY</th><th>ROLE</th><th>JURISDICTION</th>
                <th>ADDRESS</th><th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.address}>
                  <td className="t-id">{e.name}</td>
                  <td>{e.role}</td>
                  <td className="t-dim">{e.jurisdiction || "--"}</td>
                  <td className="t-dim">
                    <a href={explorerAddress(e.address)} target="_blank" rel="noreferrer">
                      {shortAddress(e.address)}
                    </a>
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        e.status === "Verified" ? "ok" : e.status === "Restricted" ? "bad" : "warn"
                      }`}
                    >
                      {e.status.toUpperCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="callout">
        <b>Verification here is a governance claim, not a proof.</b> A registrar asserted the
        entity is who it says. The cryptographic commitment in this protocol is the document
        hash on the receivable; this registry is the social layer beside it, and the two are
        deliberately different kinds of fact.
      </p>

      <div className="cols">
        <RegisterCounterparty onDone={refresh} />
        <SetCounterpartyStatus entities={list} onDone={refresh} />
      </div>
    </>
  );
}
