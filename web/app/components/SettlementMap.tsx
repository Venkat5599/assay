"use client";

import {useState} from "react";

/**
 * The settlement map.
 *
 * Drawn as a single SVG on a 100x100 grid so nodes and connectors share one
 * coordinate space - they cannot drift apart the way absolutely-positioned
 * boxes joined by CSS lines eventually do.
 *
 * Selecting a stage on the left lights the nodes and edges that stage touches.
 * The whole graph is always rendered; the selection changes emphasis only, so
 * nothing is hidden behind an interaction.
 */

type Stage = "escrow" | "contest" | "settle";

const STAGES: {id: Stage; label: string; body: string}[] = [
  {
    id: "escrow",
    label: "Escrow",
    body: "The underwriter commits to buy the invoice at a stated price and funds that price in full. This happens before the loan exists, so the loss floor is capital already sitting in the contract.",
  },
  {
    id: "contest",
    label: "Contest",
    body: "The slot stays open. Any underwriter may displace the incumbent with a higher floor or a lower premium, and the displaced party is refunded in full, atomically.",
  },
  {
    id: "settle",
    label: "Settle",
    body: "On default the escrow pays the lender and the invoice transfers to the underwriter, in one block. Proceeds above the debt return to the carrier, so default is never profitable for the pool.",
  },
];

interface Node {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  stages: Stage[];
}

const W = 26;
const H = 13;

const NODES: Node[] = [
  {id: "carrier", label: "CARRIER", x: 8, y: 8, stages: ["settle"]},
  {id: "invoice", label: "INVOICE", sub: "collateral", x: 8, y: 40, stages: ["escrow", "settle"]},
  {id: "slot", label: "BID SLOT", sub: "contestable", x: 40, y: 24, stages: ["escrow", "contest"]},
  {id: "escrow", label: "ESCROW", sub: "37,481", x: 40, y: 60, stages: ["escrow", "settle"]},
  {id: "lender", label: "LENDER", sub: "made whole", x: 8, y: 78, stages: ["settle"]},
  {id: "uw1", label: "BOOK 01", sub: "28,560", x: 70, y: 6, stages: ["contest"]},
  {id: "uw2", label: "BOOK 02", sub: "35,549", x: 70, y: 40, stages: ["contest"]},
  {id: "uw3", label: "BOOK 03", sub: "37,481", x: 70, y: 74, stages: ["escrow", "contest", "settle"]},
];

const byId = (id: string) => NODES.find((n) => n.id === id)!;

interface Edge {
  from: string;
  to: string;
  stages: Stage[];
  /** Route out of the right face of `from` into the left face of `to`. */
  side?: "h" | "v";
}

const EDGES: Edge[] = [
  {from: "invoice", to: "slot", stages: ["escrow"], side: "h"},
  {from: "uw1", to: "slot", stages: ["contest"], side: "h"},
  {from: "uw2", to: "slot", stages: ["contest"], side: "h"},
  {from: "uw3", to: "slot", stages: ["contest"], side: "h"},
  {from: "uw3", to: "escrow", stages: ["escrow"], side: "h"},
  {from: "escrow", to: "lender", stages: ["settle"], side: "h"},
  {from: "invoice", to: "uw3", stages: ["settle"], side: "h"},
  {from: "carrier", to: "invoice", stages: ["settle"], side: "v"},
];

/** Orthogonal route between two node boxes, so lines never cut a corner. */
function path(e: Edge): string {
  const a = byId(e.from);
  const b = byId(e.to);
  const ac = {x: a.x + W / 2, y: a.y + H / 2};
  const bc = {x: b.x + W / 2, y: b.y + H / 2};

  if (e.side === "v") {
    return `M ${ac.x} ${a.y + H} L ${ac.x} ${b.y}`;
  }

  const fromRight = ac.x < bc.x;
  const sx = fromRight ? a.x + W : a.x;
  const ex = fromRight ? b.x : b.x + W;
  const mid = (sx + ex) / 2;
  return `M ${sx} ${ac.y} L ${mid} ${ac.y} L ${mid} ${bc.y} L ${ex} ${bc.y}`;
}

export function SettlementMap() {
  const [active, setActive] = useState<Stage>("escrow");

  return (
    <div className="map">
      <div className="map-copy">
        <h2 className="display">Escrow first. Settle in one block.</h2>
        <p className="section-lead">
          Everything a lending protocol normally outsources to a market, LADING replaces with
          capital somebody already committed.
        </p>

        <div className="stages">
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              className={s.id === active ? "stage on" : "stage"}
              onMouseEnter={() => setActive(s.id)}
              onFocus={() => setActive(s.id)}
              onClick={() => setActive(s.id)}
              aria-pressed={s.id === active}
            >
              <span className="stage-head">
                <span className="num">{String(i + 1).padStart(2, "0")}</span>
                <span className="stage-label">{s.label}</span>
              </span>
              <span className="stage-body">{s.body}</span>
            </button>
          ))}
        </div>
      </div>

      <figure className="map-fig">
        <figcaption className="label map-cap">
          Settlement path &mdash; {STAGES.find((s) => s.id === active)!.label.toLowerCase()}
        </figcaption>
        <svg viewBox="-2 -2 104 96" role="img" aria-label="Settlement path diagram">
          <g className="edges">
            {EDGES.map((e) => {
              const on = e.stages.includes(active);
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={path(e)}
                  className={on ? "edge on" : "edge"}
                  fill="none"
                />
              );
            })}
          </g>
          <g className="nodes">
            {NODES.map((n) => {
              const on = n.stages.includes(active);
              return (
                <g key={n.id} className={on ? "node on" : "node"}>
                  <rect x={n.x} y={n.y} width={W} height={H} rx="0" />
                  <text x={n.x + W / 2} y={n.sub ? n.y + H / 2 - 1.6 : n.y + H / 2} className="n-label">
                    {n.label}
                  </text>
                  {n.sub && (
                    <text x={n.x + W / 2} y={n.y + H / 2 + 3.4} className="n-sub">
                      {n.sub}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <p className="map-foot label">
          no auction &nbsp;/&nbsp; no orderbook &nbsp;/&nbsp; no oracle
        </p>
      </figure>
    </div>
  );
}
