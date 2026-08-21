/**
 * The two diagrams that carry the argument on the landing page.
 *
 * They were ASCII inside <pre>, which was defensible: text scales, selects,
 * and cannot drift out of sync with a design file that does not exist. What it
 * could not do was draw. A gap is a length, a severed connection is a broken
 * line, and a decaying floor is a slope - none of those survive being spelled
 * with plus signs and hyphens.
 *
 * These are SVG, and they keep every property the text had. The labels are
 * real <text>, so they select and read aloud in order; the geometry scales with
 * the viewBox rather than with a font size that had to be clamped to stop the
 * columns wrapping. Nothing here is an image.
 *
 * Motion is additive only. Every element renders at its final geometry and the
 * animation moves it from somewhere else - so if the animation never runs, is
 * throttled, or the visitor asked for less of it, the diagram is still whole.
 */

/** Days 0 to 90: money leaves immediately, arrives at the end. */
export function CashGap() {
  return (
    <figure className="dia dia-gap">
      <svg viewBox="0 0 560 268" role="img" aria-labelledby="gapTitle gapDesc">
        <title id="gapTitle">The cash gap on a freight invoice</title>
        <desc id="gapDesc">
          A carrier pays for fuel, drivers and insurance on day zero, carries rent, payroll and
          the next load across an unpaid gap of about ninety days, and is paid only at the end.
        </desc>

        {/* The spine: delivery, then the gap, then settlement. */}
        <g className="dia-spine">
          <line x1="28" y1="70" x2="532" y2="70" />
          <line className="dia-tick" x1="28" y1="58" x2="28" y2="82" />
          <line className="dia-tick" x1="118" y1="58" x2="118" y2="82" />
          <line className="dia-tick" x1="532" y1="58" x2="532" y2="82" />
        </g>

        <g className="dia-day">
          <text x="28" y="44">DAY 0</text>
          <text x="118" y="44">DAY 1</text>
          <text x="532" y="44" textAnchor="end">DAY 90</text>
        </g>

        {/* The gap itself, measured. This is the whole subject of the drawing. */}
        <g className="dia-gapspan">
          <path d="M118 70 L532 70" />
          <text x="325" y="99" textAnchor="middle">UNPAID GAP</text>
        </g>

        <g className="dia-node">
          <rect x="16" y="56" width="26" height="28" rx="2" />
          <rect x="506" y="56" width="26" height="28" rx="2" />
        </g>
        <g className="dia-nodelabel">
          <text x="29" y="75" textAnchor="middle">L</text>
          <text x="519" y="75" textAnchor="middle">P</text>
        </g>

        {/* What the money is actually doing underneath the timeline. */}
        <g className="dia-flow">
          <text x="28" y="139">fuel, driver,</text>
          <text x="28" y="155">insurance</text>
          <text x="180" y="139">rent, payroll,</text>
          <text x="180" y="155">the next load</text>
          <text x="532" y="139" textAnchor="end">shipper</text>
          <text x="532" y="155" textAnchor="end">settles</text>
        </g>

        {/* Bars render at full length; the animation only slides them in. */}
        <g className="dia-bars">
          <text className="dia-barlabel" x="28" y="196">OUT</text>
          <rect className="dia-bar out" x="66" y="185" width="330" height="9" rx="1" />
          <text className="dia-barlabel" x="28" y="224">IN</text>
          <rect className="dia-bar in" x="440" y="213" width="92" height="9" rx="1" />
        </g>

        <text className="dia-note" x="28" y="256">
          The work is performed first and paid for last.
        </text>
      </svg>
    </figure>
  );
}

/**
 * What the firm bid market does not have.
 *
 * The three severed dependencies are drawn as connections that are actually
 * cut - a line that stops, a gap, then the far end left dangling. Writing
 * "[severed]" beside an intact row asked the reader to take the claim on trust
 * when the claim is a shape.
 */
export function SeveredPlate() {
  const severed = ["ORACLE", "AUCTION", "SECONDARY MARKET"];
  const holds = [
    ["PURCHASE PRICE", "ESCROWED 100%"],
    ["FUNDED", "PRE-ORIGINATION"],
    ["SETTLEMENT", "1 BLOCK"],
  ];

  return (
    <figure className="dia dia-plate" data-parallax="6">
      <svg viewBox="0 0 340 232" role="img" aria-labelledby="plateTitle plateDesc">
        <title id="plateTitle">What the firm bid market runs without</title>
        <desc id="plateDesc">
          The market has no oracle, no auction and no secondary market. The purchase price is
          escrowed in full before origination and settlement takes one block.
        </desc>

        <text className="dia-plate-head" x="0" y="12">FIRM BID MARKET</text>
        <line className="dia-plate-rule" x1="0" y1="24" x2="340" y2="24" />

        {severed.map((row, i) => {
          const y = 48 + i * 26;
          return (
            <g className="dia-sev" key={row} style={{["--i" as string]: i}}>
              <text x="0" y={y + 4}>{row}</text>
              {/* A connection drawn as broken: it stops, and the far end hangs. */}
              <line className="dia-cut-a" x1="150" y1={y} x2="236" y2={y} />
              <line className="dia-cut-b" x1="262" y1={y} x2="292" y2={y} />
              <line className="dia-cut-end" x1="292" y1={y - 5} x2="292" y2={y + 5} />
              <path className="dia-cut-mark" d={`M243 ${y - 8} L255 ${y + 8}`} />
              <path className="dia-cut-mark" d={`M255 ${y - 8} L243 ${y + 8}`} />
            </g>
          );
        })}

        <line className="dia-plate-rule" x1="0" y1="128" x2="340" y2="128" />

        {holds.map(([k, v], i) => {
          const y = 152 + i * 24;
          return (
            <g className="dia-hold" key={k}>
              <text x="0" y={y}>{k}</text>
              <text x="340" y={y} textAnchor="end">{v}</text>
            </g>
          );
        })}

        <line className="dia-plate-rule" x1="0" y1="212" x2="340" y2="212" />
        <text className="dia-plate-foot" x="0" y="228">READ LIVE FROM CHAIN</text>
      </svg>
    </figure>
  );
}
