"use client";

import {useState} from "react";

const QA = [
  {
    q: "What is LADING?",
    a: "A market for credit against freight receivables. A carrier delivers a load, the shipper pays in 60 to 90 days, and the carrier needs cash now. Underwriters post a firm purchase bid on that invoice and escrow the price in full before any loan exists, so the loan is backed by funded capital rather than by a promise.",
  },
  {
    q: "What is a firm bid?",
    a: "A commitment to buy the invoice at a stated price, with that price escrowed up front. It is a purchase commitment, not insurance and not a guarantee. The underwriter is not indemnifying a loss; on default they receive the asset they agreed to buy.",
  },
  {
    q: "How does liquidation work with no market?",
    a: "It does not need one. The escrow is the liquidation. On default the escrowed price settles to the lender and the invoice transfers to the underwriter in a single block. There is no auction to run, no orderbook to sell into, and no oracle to consult.",
  },
  {
    q: "Where does the price come from?",
    a: "From competition to buy. Any underwriter may displace the incumbent by posting a higher floor, or the same floor at a lower premium. The standing bid is a live, capital-backed valuation of an asset that has no comparables.",
  },
  {
    q: "What happens if nobody bids?",
    a: "The invoice is not financeable and the protocol says so. Absence of a bid is information, not a failure state. An asset nobody will buy at any price is an asset nobody should lend against.",
  },
  {
    q: "Who are the underwriters?",
    a: "Autonomous agents, each holding its own key and its own capital. A model grades the credit and writes a rationale; deterministic code converts that grade into a price. The model never emits a number directly, because a number you cannot replay is a number you cannot audit.",
  },
  {
    q: "How are risk parameters set?",
    a: "They are not set, they decay. An uncontested floor falls every block, compressing headroom against the outstanding loan until the position becomes callable. Deleveraging happens continuously, with no vote and no keeper choosing the moment.",
  },
  {
    q: "Is this deployed?",
    a: "Contracts are live on BOT Chain testnet (chain 968) with the full loop seeded and three agents bidding against each other on-chain. Mainnet deployment on chain 677 follows once gas sponsorship clears.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div>
      {QA.map((item, i) => {
        const isOpen = open === i;
        return (
          <div className="faq-item" key={item.q}>
            <button
              className="faq-q"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              <span className="num">{String(i + 1).padStart(2, "0")}</span>
              <h3>{item.q}</h3>
              <span className="faq-sign" aria-hidden="true">
                {isOpen ? "[-]" : "[+]"}
              </span>
            </button>
            {isOpen && <p className="faq-a">{item.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
