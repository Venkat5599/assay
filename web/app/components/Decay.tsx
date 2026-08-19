"use client";

import {useMemo} from "react";

import {usd} from "@/lib/format";
import type {Position} from "@/lib/useOps";

/**
 * The decay projection.
 *
 * Floor decay is the mechanism that makes risk parameters governance-free: an
 * uncontested bid erodes every block until headroom against the loan vanishes
 * and the position becomes callable, with no vote and no keeper choosing the
 * moment. The product asserted that in prose for months while the contract's
 * decay rate sat permanently at zero. It is real now, so it should be visible -
 * a claim the user can only read is a claim they have to take on trust.
 *
 * Everything below is computed from the slot's own decay rate, read from chain,
 * against the same arithmetic `_tick` performs. Nothing here is illustrative.
 */

const RAY = 1e27;

/** BOT Chain, measured over 1000 blocks at the head. */
const BLOCK_SECONDS = 0.75;

/** Mirrors FirmBidMarket.haircutBps. */
const HAIRCUT = 0.2;

interface Projection {
  /** Fractional decay per block. */
  rate: number;
  /** Floor beneath which maxBorrow no longer covers the debt. */
  callableAt: number;
  /** Blocks until that happens, or null when it never does. */
  blocks: number | null;
  days: number | null;
  /** Sampled floor curve, oldest first. */
  curve: {day: number; floor: number}[];
  horizonDays: number;
  floorNow: number;
  debt: number;
}

function project(p: Position): Projection | null {
  const rate = Number(p.decayRate) / RAY;
  const floorNow = Number(p.floor);
  const debt = Number(p.debt);
  if (floorNow <= 0) return null;

  // Callable when maxBorrow = floor x (1 - haircut) falls under the debt.
  const callableAt = debt / (1 - HAIRCUT);

  let blocks: number | null = null;
  if (rate > 0 && debt > 0 && callableAt < floorNow) {
    // floor x (1 - r)^n = target  ->  n = ln(target / floor) / ln(1 - r)
    blocks = Math.log(callableAt / floorNow) / Math.log(1 - rate);
  }
  const days = blocks === null ? null : (blocks * BLOCK_SECONDS) / 86_400;

  // Show the crossing with room around it, or a default window when there is
  // no crossing to show.
  const horizonDays = Math.max(7, Math.ceil((days ?? 90) * 1.35));
  const steps = 48;
  const curve = Array.from({length: steps + 1}, (_, i) => {
    const day = (horizonDays * i) / steps;
    const n = (day * 86_400) / BLOCK_SECONDS;
    // `_tick` clamps decay at the outstanding debt, so the lender is always
    // made whole. The curve flattens there rather than continuing down.
    return {day, floor: Math.max(floorNow * Math.pow(1 - rate, n), debt)};
  });

  return {rate, callableAt, blocks, days, curve, horizonDays, floorNow, debt};
}

export function DecayProjection({p}: {p: Position}) {
  const proj = useMemo(() => project(p), [p]);

  if (!proj || proj.rate === 0) {
    return (
      <p className="callout">
        <b>No decay on this slot.</b> Either nothing is priced yet, or it was struck under a zero
        decay rate.
      </p>
    );
  }

  const {curve, horizonDays, callableAt, days, floorNow, debt} = proj;

  // Plot area in a 100x46 user-space box, so the curve and its guides share one
  // coordinate system and cannot drift apart.
  const W = 100;
  const H = 46;
  const top = Math.max(floorNow, callableAt) * 1.06;
  const bottom = Math.min(debt, callableAt, curve[curve.length - 1]!.floor) * 0.94;
  const span = top - bottom || 1;

  const x = (day: number) => (day / horizonDays) * W;
  const y = (v: number) => H - ((v - bottom) / span) * H;

  const path = curve.map((c, i) => `${i === 0 ? "M" : "L"} ${x(c.day).toFixed(2)} ${y(c.floor).toFixed(2)}`).join(" ");
  const crossX = days !== null && days <= horizonDays ? x(days) : null;

  const perDay = (1 - Math.pow(1 - proj.rate, 86_400 / BLOCK_SECONDS)) * 100;

  return (
    <div className="decay">
      <div className="decay-stats">
        <div>
          <span className="label">EROSION</span>
          <div className="metric-v">{perDay.toFixed(3)}%</div>
          <div className="metric-n">per day, uncontested</div>
        </div>
        <div>
          <span className="label">CALLABLE AT</span>
          <div className="metric-v">{usd(BigInt(Math.round(callableAt)))}</div>
          <div className="metric-n">floor where headroom ends</div>
        </div>
        <div>
          <span className="label">TIME TO CALLABLE</span>
          <div className={`metric-v${days !== null && days < 14 ? " warn" : ""}`}>
            {debt === 0 ? "n/a" : days === null ? "already" : `${days.toFixed(1)}d`}
          </div>
          <div className="metric-n">
            {debt === 0 ? "nothing drawn" : "if nobody contests"}
          </div>
        </div>
      </div>

      <figure className="decay-fig">
        <figcaption className="label">
          Standing floor, projected at the slot&rsquo;s own decay rate
        </figcaption>
        <svg viewBox={`0 -3 ${W} ${H + 12}`} role="img" aria-label="Projected floor decay against the outstanding loan">
          {/* the level at which the position becomes callable */}
          <line className="decay-thresh" x1="0" x2={W} y1={y(callableAt)} y2={y(callableAt)} />
          {debt > 0 && (
            <line className="decay-debt" x1="0" x2={W} y1={y(debt)} y2={y(debt)} />
          )}

          <path className="decay-curve" d={path} fill="none" />

          {crossX !== null && (
            <>
              <line className="decay-cross" x1={crossX} x2={crossX} y1="0" y2={H} />
              <circle className="decay-dot" cx={crossX} cy={y(callableAt)} r="1.1" />
            </>
          )}

          <text className="decay-ax" x="0" y={H + 7}>
            today
          </text>
          <text className="decay-ax decay-ax-end" x={W} y={H + 7}>
            {Math.round(horizonDays)}d
          </text>
        </svg>
        <div className="decay-key">
          <span>
            <i className="k-curve" /> standing floor
          </span>
          {debt > 0 && (
            <span>
              <i className="k-debt" /> outstanding {usd(p.debt)}
            </span>
          )}
          <span>
            <i className="k-thresh" /> callable below {usd(BigInt(Math.round(callableAt)))}
          </span>
        </div>
      </figure>

      <p className="callout">
        <b>Nobody triggers this.</b> The floor falls every block while the bid stands
        uncontested, and the loan becomes callable the moment{" "}
        <span className="mono">maxBorrow</span> drops under the debt. A better bid resets it: a
        contest writes a fresh floor and restarts the clock, so decay only ever bites an opinion
        nobody has restated. The curve flattens at the outstanding debt because{" "}
        <span className="mono">_tick</span> clamps it there &mdash; a decaying floor compresses
        headroom, but it can never leave the lender under-covered.
      </p>
    </div>
  );
}
