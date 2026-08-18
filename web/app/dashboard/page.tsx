"use client";

import {useState} from "react";
import {useAccount, useReadContract, useWriteContract} from "wagmi";

import {LiveBook} from "../components/LiveBook";
import {Wallet} from "../components/Wallet";
import {marketAbi, registryAbi, vaultAbi} from "@/lib/abi";
import {addresses, isDeployed} from "@/lib/addresses";
import {explorerAddress, IS_TESTNET} from "@/lib/chain";
import {usd, shortAddress} from "@/lib/format";

/**
 * Operations console.
 *
 * Every figure is read from chain. Where a value has not arrived yet it renders
 * as "--" rather than as a placeholder that could be mistaken for data. Nothing
 * on this page is stored in the page.
 */

const ASSET_IDS = [1n, 2n, 3n];

/** Agent identities are deployment config, not chain state. */
const AGENTS = [
  {name: "CONSERVATIVE", addr: "0xb7E28bEbBFdBbA0D7884b740cb25F358C9D9edf1"},
  {name: "SECTOR", addr: "0x6B4Db50f8B79b739860DB1B2948243e8Af36A764"},
  {name: "AGGRESSIVE", addr: "0xf739FAc50486662A5aB90273a87345e0486E6EC5"},
];

const ZERO = "0x0000000000000000000000000000000000000000";
const poll = {refetchInterval: 5000} as const;

const pct = (num?: bigint, den?: bigint) =>
  num !== undefined && den !== undefined && den > 0n ? Number((num * 10000n) / den) / 100 : 0;

const dateOf = (unix?: bigint) =>
  unix ? new Date(Number(unix) * 1000).toISOString().slice(0, 10) : "--";

const daysTo = (unix?: bigint) =>
  unix ? Math.round((Number(unix) * 1000 - Date.now()) / 86_400_000) : null;

/** One row of the portfolio table. Each row owns its own reads. */
function LoadRow({id, selected, onSelect}: {id: bigint; selected: boolean; onSelect: () => void}) {
  const enabled = isDeployed;
  const q = {enabled, ...poll};

  const {data: r} = useReadContract({
    abi: registryAbi, address: addresses.assetRegistry, functionName: "receivableOf",
    args: [id], query: q,
  });
  const {data: floor} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "currentFloor",
    args: [id], query: q,
  });
  const {data: debt} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "outstanding",
    args: [id], query: q,
  });
  const {data: cap} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "maxBorrow",
    args: [id], query: q,
  });
  const {data: slot} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "slots",
    args: [id], query: q,
  });

  const bid = Boolean(slot?.underwriter && slot.underwriter !== ZERO);
  const util = pct(debt as bigint | undefined, cap as bigint | undefined);
  const advance = pct(floor as bigint | undefined, r?.faceValue);
  const days = daysTo(r?.dueDate);
  const status = !bid ? "UNPRICED" : (debt as bigint | undefined) ? "DRAWN" : "PRICED";

  return (
    <tr className={selected ? "on" : undefined} onClick={onSelect}>
      <td className="t-id">#{id.toString()}</td>
      <td className="t-num">{r ? usd(r.faceValue) : "--"}</td>
      <td className="t-num">{usd(floor as bigint | undefined)}</td>
      <td className="t-num">{advance ? `${advance.toFixed(0)}%` : "--"}</td>
      <td className="t-num">{usd(debt as bigint | undefined)}</td>
      <td>
        <span className="meter" title={`${util.toFixed(0)}% of headroom drawn`}>
          <i style={{width: `${Math.min(util, 100)}%`}} />
        </span>
      </td>
      <td className="t-num">{days === null ? "--" : `${days}d`}</td>
      <td>
        <span className={`chip ${status.toLowerCase()}`}>{status}</span>
      </td>
    </tr>
  );
}

export default function Dashboard() {
  const [selected, setSelected] = useState<bigint>(2n);
  const [busy, setBusy] = useState<string | null>(null);
  const {isConnected} = useAccount();
  const {writeContractAsync} = useWriteContract();

  const enabled = isDeployed;
  const q = {enabled, ...poll};

  const {data: r} = useReadContract({
    abi: registryAbi, address: addresses.assetRegistry, functionName: "receivableOf",
    args: [selected], query: q,
  });
  const {data: floor} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "currentFloor",
    args: [selected], query: q,
  });
  const {data: room} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "availableToBorrow",
    args: [selected], query: q,
  });
  const {data: debt} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "outstanding",
    args: [selected], query: q,
  });
  const {data: cap} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "maxBorrow",
    args: [selected], query: q,
  });
  const {data: slot} = useReadContract({
    abi: marketAbi, address: addresses.market, functionName: "slots",
    args: [selected], query: q,
  });
  const {data: defaulted} = useReadContract({
    abi: vaultAbi, address: addresses.vault, functionName: "isDefaulted",
    args: [selected], query: q,
  });

  const underwriter = slot?.underwriter;
  const hasBid = Boolean(underwriter && underwriter !== ZERO);
  const util = pct(debt as bigint | undefined, cap as bigint | undefined);
  const days = daysTo(r?.dueDate);

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

  const canAct = isConnected && enabled;

  return (
    <div className="dash">
      <aside className="side">
        <div className="side-brand">
          <a href="/">LADING</a>
        </div>

        <div className="side-group">
          <span className="label">Portfolio</span>
          {ASSET_IDS.map((id) => (
            <button
              key={id.toString()}
              className={id === selected ? "side-link on" : "side-link"}
              onClick={() => setSelected(id)}
              aria-current={id === selected}
            >
              <span>ASSET #{id.toString()}</span>
              <span>{id === selected ? "open" : ""}</span>
            </button>
          ))}
        </div>

        <div className="side-group">
          <span className="label">Underwriter books</span>
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
          {(
            [
              ["MARKET", addresses.market],
              ["VAULT", addresses.vault],
              ["REGISTRY", addresses.assetRegistry],
            ] as const
          ).map(([name, addr]) =>
            addr ? (
              <a
                key={name}
                className="side-link"
                href={explorerAddress(addr)}
                target="_blank"
                rel="noreferrer"
              >
                <span>{name}</span>
                <span>{shortAddress(addr)}</span>
              </a>
            ) : (
              <span className="side-link" key={name}>
                <span>{name}</span>
                <span>pending</span>
              </span>
            ),
          )}
        </div>

        <div className="side-foot">
          <div>{IS_TESTNET ? "BOT CHAIN TESTNET 968" : "BOT CHAIN 677"}</div>
          <div>{enabled ? "READS LIVE" : "ADDRESSES UNSET"}</div>
        </div>
      </aside>

      <main className="dash-main">
        <div className="dash-bar">
          <div>
            <div className="dash-title">Asset #{selected.toString()}</div>
            <div className="num">{r ? `DOC ${r.docHash.slice(0, 26)}...` : "READING REGISTRY"}</div>
          </div>
          <div className="hero-actions" style={{marginTop: 0}}>
            <span className="live-dot">
              <i aria-hidden="true" />
              {enabled ? "POLLING CHAIN" : "OFFLINE"}
            </span>
            <Wallet />
          </div>
        </div>

        <div className="dash-pad">
          <div className="stats">
            <div>
              <span className="label">FACE VALUE</span>
              <div className="stat-figure">{r ? usd(r.faceValue) : "--"}</div>
              <div className="stat-note">due {dateOf(r?.dueDate)}</div>
            </div>
            <div>
              <span className="label">STANDING BID</span>
              <div className="stat-figure">{usd(floor as bigint | undefined)}</div>
              <div className="stat-note">{hasBid ? "escrowed in full" : "no bid"}</div>
            </div>
            <div>
              <span className="label">DRAWABLE</span>
              <div className="stat-figure">{usd(room as bigint | undefined)}</div>
              <div className="stat-note">after haircut</div>
            </div>
            <div>
              <span className="label">OUTSTANDING</span>
              <div className="stat-figure">{usd(debt as bigint | undefined)}</div>
              <div className="stat-note">{defaulted ? "callable" : "within headroom"}</div>
            </div>
          </div>

          <div className="panel-title">
            <h2>Portfolio</h2>
            <span className="num">{ASSET_IDS.length} REGISTERED</span>
          </div>
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ASSET</th>
                  <th className="t-num">FACE</th>
                  <th className="t-num">FLOOR</th>
                  <th className="t-num">ADV</th>
                  <th className="t-num">DEBT</th>
                  <th>UTILISATION</th>
                  <th className="t-num">DUE</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {ASSET_IDS.map((id) => (
                  <LoadRow
                    key={id.toString()}
                    id={id}
                    selected={id === selected}
                    onSelect={() => setSelected(id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="cols">
            <section>
              <div className="panel-title">
                <h2>Position</h2>
                <span className="num">ASSET #{selected.toString()}</span>
              </div>
              <dl className="kv">
                <div>
                  <dt>Headroom used</dt>
                  <dd>
                    <span className="meter wide">
                      <i style={{width: `${Math.min(util, 100)}%`}} />
                    </span>
                    <b>{util.toFixed(1)}%</b>
                  </dd>
                </div>
                <div>
                  <dt>Days to settlement</dt>
                  <dd>{days === null ? "--" : days}</dd>
                </div>
                <div>
                  <dt>Obligor</dt>
                  <dd className="mono">{r ? r.debtor : "--"}</dd>
                </div>
                <div>
                  <dt>Document hash</dt>
                  <dd className="mono">{r ? r.docHash : "--"}</dd>
                </div>
                <div>
                  <dt>Incumbent</dt>
                  <dd className="mono">{hasBid ? (underwriter as string) : "none"}</dd>
                </div>
                <div>
                  <dt>Premium reserve</dt>
                  <dd>{slot ? usd(slot.premiumReserve) : "--"}</dd>
                </div>
              </dl>
            </section>

            <section>
              <div className="panel-title">
                <h2>Actions</h2>
                <span className="num">{canAct ? "SIGNER READY" : "CONNECT WALLET"}</span>
              </div>
              <div className="actions-col">
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
                  {busy === "borrow" ? "Drawing" : "Draw maximum"}{" "}
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
                <p className="callout" style={{marginTop: "0.25rem"}}>
                  <b>Settle default stays disabled until the position is callable.</b> It opens
                  when the receivable matures unpaid, or when floor decay compresses headroom
                  below the debt. The contract enforces this regardless of this page.
                </p>
              </div>
            </section>
          </div>

          <div className="panel-title">
            <h2>Order book</h2>
            <span className="num">BidPlaced LOGS</span>
          </div>
          <LiveBook assetId={selected} />
        </div>
      </main>
    </div>
  );
}
