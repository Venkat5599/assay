"use client";

import {useMemo, useState} from "react";
import {useAccount, useReadContract, useWriteContract} from "wagmi";

import {Faq} from "./components/Faq";
import MoltenMetal from "./components/MoltenMetal";
import {LiveBook} from "./components/LiveBook";
import {Nav} from "./components/Nav";
import {ReduceMotionToggle} from "./components/Motion";
import {SettlementMap} from "./components/SettlementMap";
import {Wallet} from "./components/Wallet";
import {marketAbi, registryAbi, vaultAbi} from "@/lib/abi";
import {addresses, isDeployed} from "@/lib/addresses";
import {explorerAddress, IS_TESTNET} from "@/lib/chain";
import {usd, shortAddress} from "@/lib/format";

/**
 * Asset #2 on BOT Chain testnet - the load the agents actually contested.
 * Figures are polled from the chain; the constants below are the recorded
 * terms, present so the page renders completely before any RPC returns.
 */
const LOAD = {
  /** Registered on BOT Chain testnet. Only these fields exist on chain. */
  assetId: 2n,
  docHash: "0x20355c1e4181601b",
};

const TICKER = [
  "NO ORACLE",
  "NO AUCTION",
  "NO SECONDARY MARKET",
  "ESCROW BEFORE ORIGINATION",
  "SETTLES IN ONE BLOCK",
  "AGENT UNDERWRITERS",
  "BOT CHAIN",
];

const PROBLEM = [
  {
    kicker: "CASH-FLOW INVERSION",
    n: "001",
    h: "The work is paid for last.",
    p: "A carrier fuels the truck, pays the driver, and delivers the load. Then waits 60 to 90 days. The gap gets financed by whoever can least afford it.",
  },
  {
    kicker: "NO ORDERBOOK",
    n: "002",
    h: "The collateral cannot be sold.",
    p: "One receivable against one shipper has no market. DeFi lending stays solvent only because liquidation is instant, and instant liquidation needs a buyer standing by.",
  },
  {
    kicker: "DEAD CAPITAL",
    n: "003",
    h: "Over-collateralisation defeats the point.",
    p: "Demanding two to three times the loan in collateral is the standard workaround. A business borrowing against an invoice does not have it.",
  },
  {
    kicker: "TRUST DOES NOT SCALE",
    n: "004",
    h: "Lending on a promise collapses.",
    p: "Goldfinch took roughly 18M in defaults and wound down in June 2026. Undercollateralised credit with no funded floor has one ending.",
  },
];

const PILLARS = [
  {
    kicker: "ESCROW FIRST",
    h: "Funded before origination.",
    p: "The underwriter escrows the full purchase price before the loan exists. The loss floor is capital already sitting in the contract, not a bid discovered at auction after something has gone wrong.",
  },
  {
    kicker: "CONTESTABLE",
    h: "Priced by competition to buy.",
    p: "Any underwriter may displace the incumbent with a higher floor or a lower premium. Competition to purchase produces a live valuation for an asset with no comparables.",
  },
  {
    kicker: "DECAY",
    h: "Risk that updates itself.",
    p: "An uncontested floor falls every block until headroom against the loan vanishes and the position becomes callable. Parameters move continuously, with no vote and no keeper.",
  },
];

const CAPABILITIES = [
  {
    n: "01",
    h: "Registers the paperwork, not a claim about it.",
    p: "The bill of lading is committed as a document hash on an ERC-721 record. Hashes are unique, so pledging the same paperwork twice is rejected at registration.",
  },
  {
    n: "02",
    h: "Grades credit, then prices it separately.",
    p: "A model emits a risk grade and a written rationale. Deterministic code turns that grade into a floor. The model never produces the number that moves capital.",
  },
  {
    n: "03",
    h: "Puts the agent's own capital behind the call.",
    p: "A bid pulls escrow from the agent that placed it. A generous grade is paid for by whoever produced it, which is what makes the diligence real.",
  },
  {
    n: "04",
    h: "Settles default atomically.",
    p: "Escrow to the lender, invoice to the underwriter, one block. Proceeds above the debt return to the borrower, because default must never be profitable for the pool.",
  },
  {
    n: "05",
    h: "Rejects honestly.",
    p: "No bid means the load is not financeable, and the protocol says so plainly rather than inventing a price for it.",
  },
  {
    n: "06",
    h: "Gates participation without touching market logic.",
    p: "A pluggable compliance module fronts borrow, lend, and underwrite. Adapting to a jurisdiction means swapping that module, not rewriting the market.",
  },
];



const TIMELINE = `  DAY 0        DAY 1                          DAY 90
  +------+     +--------------------------+   +------+
  | LOAD |---->|        UNPAID GAP        |-->| PAID |
  +------+     +--------------------------+   +------+
     |                     |                      |
  fuel, driver,     rent, payroll,           shipper
  insurance         the next load            settles
     |                     |                      |
   CASH OUT             CASH OUT              CASH IN

  ------------------------------------------------------
  out  ####################################
  in                                       ###########
  ------------------------------------------------------
  The work is performed first and paid for last.`;


const TERMINAL = `$ bun run src/index.ts --once

LADING agents: CONSERVATIVE, SECTOR, AGGRESSIVE
judgment: rubric
market:   0x6438EDAeebF482212fbcf5a681Be0b698f952F05

asset #2 . face 42,000 . doc 0x20355c1e
  CONSERVATIVE  B    BID      28,560
                short 34-day tail; sizeable relative to the book
  SECTOR        A    BID      35,549
                comfortable size; this book knows the obligor
  AGGRESSIVE    A    BID      37,481
                wants the asset; displaces the incumbent
  standing floor -> 37,481

asset #3 . face 180,000 . doc 0x532080aa
  CONSERVATIVE  D    ABSTAIN  past this book's ceiling
  SECTOR        D    ABSTAIN  past this book's ceiling
  AGGRESSIVE    C    BID      125,712
  standing floor -> 125,712`;

const HERO_PLATE = `+------------------------------------+
|  F I R M   B I D   M A R K E T     |
+------------------------------------+
|  ORACLE                 [ severed ]|
|  AUCTION                [ severed ]|
|  SECONDARY MARKET       [ severed ]|
+------------------------------------+
|  PURCHASE PRICE      ESCROWED 100% |
|  FUNDED              PRE-ORIGINATION|
|  SETTLEMENT               1 BLOCK  |
+------------------------------------+
|  READ LIVE FROM CHAIN              |
+------------------------------------+`;

export default function Page() {
  const {address, isConnected} = useAccount();
  const [busy, setBusy] = useState<string | null>(null);
  const {writeContractAsync} = useWriteContract();

  const live = isDeployed;
  const poll = {enabled: live, refetchInterval: 4000} as const;

  const {data: floor} = useReadContract({
    abi: marketAbi,
    address: addresses.market,
    functionName: "currentFloor",
    args: [LOAD.assetId],
    query: poll,
  });
  const {data: room} = useReadContract({
    abi: vaultAbi,
    address: addresses.vault,
    functionName: "availableToBorrow",
    args: [LOAD.assetId],
    query: poll,
  });
  const {data: debt} = useReadContract({
    abi: vaultAbi,
    address: addresses.vault,
    functionName: "outstanding",
    args: [LOAD.assetId],
    query: poll,
  });
  const {data: receivable} = useReadContract({
    abi: registryAbi,
    address: addresses.assetRegistry,
    functionName: "receivableOf",
    args: [LOAD.assetId],
    query: poll,
  });
  const face = receivable?.faceValue;

  const figures = useMemo(
    () => [
      {k: "FACE VALUE", v: usd(face), n: "from AssetRegistry"},
      {k: "STANDING BID", v: usd(floor as bigint | undefined), n: "capital escrowed"},
      {k: "DRAWABLE", v: usd(room as bigint | undefined), n: "floor less haircut"},
      {k: "OUTSTANDING", v: usd(debt as bigint | undefined), n: "principal plus interest"},
    ],
    [floor, room, debt, face],
  );

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
    <>
      <Nav />

      <header className="hero">
        {/* Decorative field. Content below is independent of it. */}
        <MoltenMetal
          color1="#c2331d"
          color2="#f2704f"
          color3="#ffd9c2"
          speed={0.28}
          scale={4.2}
          detail={3}
          glow={1.5}
          coreSize={0.1}
          swirl={1.1}
          fold={-0.22}
          blackPoint={0.06}
          brightness={1.15}
          colorMode="ember"
          grain
          grainIntensity={0.05}
          mouseInteraction
          mouseStrength={0.28}
          opacity={0.62}
        />
        <div className="hero-inner">
          <h1 className="display">
            The load moved.
            <br />
            The money didn&rsquo;t.
          </h1>
          <p className="hero-sub">
            Credit against freight receivables. Underwriters escrow the purchase price before
            the loan exists, so default settles in one block with no auction, no oracle, and no
            secondary market.
          </p>
          <div className="hero-actions">
            <a className="btn" href="/dashboard">
              See the live book <span aria-hidden="true">&gt;</span>
            </a>
            <a className="btn ghost" href="#mechanism">
              How it settles
            </a>
          </div>
          <pre className="hero-plate" data-parallax="6" aria-hidden="true">
{HERO_PLATE}
          </pre>
        </div>
        <div className="ticker" aria-hidden="true">
          {[0, 1].map((dup) => (
            <div className="ticker-track" key={dup}>
              {TICKER.map((t) => (
                <span key={t}>{t} &nbsp;/&nbsp;</span>
              ))}
            </div>
          ))}
        </div>
      </header>

      <div className="rail">
        <div className="marker-row">
          <span className="marker label" id="problem">
            <span aria-hidden="true">[x]</span> The problem
          </span>
        </div>

        <section className="section pad center">
          <h2 className="display" data-lines>Freight is credit-starved by construction.</h2>
        </section>

        <div className="split">
          <div>
            <pre className="plate" data-reveal aria-label="Timeline of a freight invoice">
              {TIMELINE}
            </pre>
          </div>
          <div className="grid g2" style={{border: 0}}>
            {PROBLEM.map((c) => (
              <article className="cell" key={c.n}>
                <div className="cell-head">
                  <span className="label">{c.kicker}</span>
                  <span className="num">{c.n}</span>
                </div>
                <h3>{c.h}</h3>
                <p>{c.p}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="marker-row">
          <span className="marker label" id="mechanism">
            <span aria-hidden="true">[/]</span> The mechanism
          </span>
        </div>

        <div style={{paddingTop: "clamp(1.5rem,3vh,2.5rem)"}}>
          <SettlementMap />
        </div>

        <div className="grid g3">
          {PILLARS.map((c) => (
            <article className="cell" key={c.kicker}>
              <div className="cell-head">
                <span className="label">{c.kicker}</span>
              </div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </article>
          ))}
        </div>

        <div className="marker-row">
          <span className="marker label" id="book">
            <span aria-hidden="true">[&gt;]</span>{" "}
            {live ? "Live book" : "Book / awaiting deployment"}
          </span>
        </div>

        <section className="section pad center">
          <h2 className="display" data-lines>Three agents. Three numbers.</h2>
          <p className="section-lead">
            Asset #{LOAD.assetId.toString()}, document {LOAD.docHash}. Each agent graded this
            load independently and escrowed its own capital behind its own number. The rows
            below are BidPlaced logs, read from chain on every poll.
          </p>
        </section>

        <div className="pad" style={{paddingBottom: "clamp(2rem,5vh,3.5rem)"}}>
          <div className="stats">
            {figures.map((f) => (
              <div key={f.k}>
                <span className="label">{f.k}</span>
                <div className="stat-figure">{f.v}</div>
                <div className="stat-note">{f.n}</div>
              </div>
            ))}
          </div>

          <LiveBook assetId={LOAD.assetId} />


          <div className="hero-actions">
            <Wallet />
            <button
              className="btn onDark"
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
              {busy === "borrow" ? "Drawing" : "Draw against this load"}{" "}
              <span aria-hidden="true">&gt;</span>
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
                    args: [LOAD.assetId, (debt as bigint) ?? 0n],
                  }),
                )
              }
            >
              {busy === "repay" ? "Repaying" : "Repay"}
            </button>
          </div>

          {live && !isConnected && (
            <p className="callout">
              <b>Reads are live from chain {IS_TESTNET ? "968" : "677"}.</b> Connect a wallet to
              draw against this load. Every figure above is polled from currentFloor and
              availableToBorrow, not stored in this page.
            </p>
          )}
          {!live && (
            <p className="callout">
              <b>Contract addresses are not configured in this build.</b> The page renders from
              the recorded terms of the load. Setting the four addresses turns the controls
              live; nothing else changes.
            </p>
          )}
        </div>

        <div className="marker-row">
          <span className="marker label">
            <span aria-hidden="true">[::]</span> Agent underwriters
          </span>
        </div>

        <section className="section pad center">
          <h2 className="display" data-lines>The model grades. The code prices.</h2>
          <p className="section-lead">
            A model that emits a number directly cannot be replayed, unit-tested, or explained
            to the carrier it just marked down. So it does not emit one. It grades the credit
            and writes a rationale; auditable arithmetic turns that grade into a floor.
          </p>
          <p className="section-lead">
            Below is a recorded sweep, not a simulation. Each BID line settled as a real
            transaction on chain 968 and moved the agent&rsquo;s own balance. The live book is
            on the dashboard.
          </p>
        </section>

        <div className="pad" style={{paddingBottom: "clamp(2rem,5vh,3.5rem)"}}>
          <div className="term" data-reveal>
            <div className="term-bar">
              <span>RECORDED RUN &middot; CHAIN 968 &middot; TX 0xc9aa81d2</span>
              <span className="term-dot" aria-hidden="true" />
            </div>
            <pre className="term-body">{TERMINAL}</pre>
          </div>
        </div>

        <div className="marker-row">
          <span className="marker label">
            <span aria-hidden="true">[+]</span> Capabilities
          </span>
        </div>

        <section className="section pad center">
          <h2 className="display" data-lines>What the contracts actually do.</h2>
        </section>

        <div className="grid g3">
          {CAPABILITIES.map((c) => (
            <article className="cell" key={c.n}>
              <div className="cell-head">
                <span className="label">[ {c.n} ]</span>
              </div>
              <h3>{c.h}</h3>
              <p>{c.p}</p>
            </article>
          ))}
        </div>

        <div className="pad" style={{paddingBlock: "clamp(2rem,5vh,3.5rem)"}}>
          <div className="stats">
            <div>
              <span className="label">SETTLEMENT</span>
              <div className="stat-figure">1 block</div>
              <div className="stat-note">no auction period</div>
            </div>
            <div>
              <span className="label">ORACLES</span>
              <div className="stat-figure">0</div>
              <div className="stat-note">no external price feed</div>
            </div>
            <div>
              <span className="label">LOSS FLOOR</span>
              <div className="stat-figure">100%</div>
              <div className="stat-note">escrowed before origination</div>
            </div>
            <div>
              <span className="label">TEST SUITE</span>
              <div className="stat-figure">23</div>
              <div className="stat-note">unit, integration, invariant</div>
            </div>
          </div>
        </div>

        <div className="marker-row">
          <span className="marker label" id="faq">
            <span aria-hidden="true">[?]</span> FAQ
          </span>
        </div>

        <section className="section pad">
          <h2 className="display center" style={{marginBottom: "clamp(2rem,4vw,3rem)"}}>
            Frequently asked questions.
          </h2>
          <Faq />
        </section>

        <footer className="footer">
          <div className="footer-grid">
            <span>LADING &middot; FREIGHT RECEIVABLE CREDIT</span>
            <span>
              {addresses.market ? (
                <a href={explorerAddress(addresses.market)} target="_blank" rel="noreferrer">
                  MARKET {shortAddress(addresses.market)}
                </a>
              ) : (
                "MARKET PENDING"
              )}
            </span>
            <a href="https://github.com/Venkat5599/assay" target="_blank" rel="noreferrer">
              SOURCE
            </a>
            <ReduceMotionToggle />
            <span>{address ? shortAddress(address) : "NOT CONNECTED"}</span>
          </div>
          <p className="footer-word">LADING</p>
        </footer>
      </div>
    </>
  );
}
