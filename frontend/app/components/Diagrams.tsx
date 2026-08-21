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
