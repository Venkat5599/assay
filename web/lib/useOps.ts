"use client";

import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react";
import {createPublicClient, http, parseAbiItem, type Address} from "viem";

import {addresses, isDeployed} from "./addresses";
import {botChain} from "./chain";
import {erc20Abi, marketAbi, registryAbi, vaultAbi} from "./abi";

/**
 * The operations data layer.
 *
 * One reader, shared by every screen. Positions are assembled from logs plus
 * contract reads and nothing else - there is no seeded list, no sample book,
 * no invented counterparty. If the chain is empty the console is empty, which
 * is the only honest thing a credit system can show.
 */

const REGISTERED = parseAbiItem(
  "event Registered(uint256 indexed id, address indexed owner, bytes32 indexed docHash, uint128 faceValue)",
);
const BID_PLACED = parseAbiItem(
  "event BidPlaced(uint256 indexed assetId, address indexed underwriter, address indexed displaced, uint256 floor, uint256 premiumRate)",
);
const BORROWED = parseAbiItem(
  "event Borrowed(uint256 indexed assetId, address indexed borrower, uint256 amount)",
);
const REPAID = parseAbiItem(
  "event Repaid(uint256 indexed assetId, address indexed payer, uint256 amount, bool closed)",
);
const SETTLED = parseAbiItem(
  "event Settled(uint256 indexed assetId, address indexed underwriter, uint256 price, uint256 refund)",
);
const DEPOSITED = parseAbiItem(
  "event Deposited(address indexed lender, uint256 amount, uint256 shares)",
);

export const ZERO = "0x0000000000000000000000000000000000000000" as Address;

/** Known agent keys. Deployment config, not chain state, and labelled as such. */
export const AGENT_BOOKS: Record<string, string> = {
  "0xb7e28bebbfdbba0d7884b740cb25f358c9d9edf1": "FREIGHT-CONSERVATIVE",
  "0x6b4db50f8b79b739860db1b2948243e8af36a764": "FREIGHT-SECTOR",
  "0xf739fac50486662a5ab90273a87345e0486e6ec5": "FREIGHT-AGGRESSIVE",
};

export const bookOf = (a?: string) =>
  a ? (AGENT_BOOKS[a.toLowerCase()] ?? `DESK ${a.slice(2, 6).toUpperCase()}`) : "--";

export interface BidEvent {
  assetId: bigint;
  underwriter: Address;
  displaced: Address;
  floor: bigint;
  premiumRate: bigint;
  block: bigint;
  hash: `0x${string}`;
}

export interface AuditEvent {
  block: bigint;
  hash: `0x${string}`;
  actor: string;
  action: string;
  contract: string;
  detail: string;
}

export interface Position {
  id: bigint;
  owner: Address;
  obligor: Address;
  docHash: `0x${string}`;
  face: bigint;
  dueDate: bigint;
  floor: bigint;
  escrow: bigint;
  premiumReserve: bigint;
  underwriter: Address;
  open: boolean;
  debt: bigint;
  cap: bigint;
  drawable: bigint;
  defaulted: boolean;
  /** Days until the obligor is due. Negative once matured. */
  days: number;
  /** floor / debt. Infinity when nothing is drawn. */
  coverage: number;
  /** debt / cap. */
  utilisation: number;
  /** floor / face. */
  advance: number;
  status: "CLOSED" | "UNPRICED" | "PRICED" | "DRAWN" | "BREACH" | "MATURING" | "DEFAULT";
}

export interface Ops {
  loading: boolean;
  error: string | null;
  positions: Position[];
  bids: BidEvent[];
  audit: AuditEvent[];
  pool: {total: bigint; idle: bigint; deployed: bigint};
  block: bigint;
  refresh: () => void;
  /** Injected by the shell so settlement lives with the other forms. */
  settleAction?: (p: Position) => ReactNode;
}

/** Coverage below this is a breach candidate; the contract's own gate is 1.0. */
export const COVERAGE_THRESHOLD = 1.2;
export const MATURITY_WINDOW_DAYS = 7;

export function useOps(): Ops {
  const [state, setState] = useState<Omit<Ops, "refresh">>({
    loading: true,
    error: null,
    positions: [],
    bids: [],
    audit: [],
    pool: {total: 0n, idle: 0n, deployed: 0n},
    block: 0n,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isDeployed) {
      setState((s) => ({...s, loading: false}));
      return;
    }
    let cancelled = false;
    const client = createPublicClient({chain: botChain, transport: http()});

    const read = async () => {
      try {
        const [registered, bids, borrows, repays, settles, deposits, block] = await Promise.all([
          client.getLogs({address: addresses.assetRegistry, event: REGISTERED, fromBlock: 0n}),
          client.getLogs({address: addresses.market, event: BID_PLACED, fromBlock: 0n}),
          client.getLogs({address: addresses.vault, event: BORROWED, fromBlock: 0n}),
          client.getLogs({address: addresses.vault, event: REPAID, fromBlock: 0n}),
          client.getLogs({address: addresses.market, event: SETTLED, fromBlock: 0n}),
          client.getLogs({address: addresses.vault, event: DEPOSITED, fromBlock: 0n}),
          client.getBlockNumber(),
        ]);

        const ids = registered.map((l) => l.args.id!);

        const reads = await Promise.all(
          ids.map(async (id) => {
            const [r, slot, debt, cap, drawable, defaulted] = await Promise.all([
              client.readContract({abi: registryAbi, address: addresses.assetRegistry!, functionName: "receivableOf", args: [id]}),
              client.readContract({abi: marketAbi, address: addresses.market!, functionName: "slots", args: [id]}),
              client.readContract({abi: vaultAbi, address: addresses.vault!, functionName: "outstanding", args: [id]}),
              client.readContract({abi: marketAbi, address: addresses.market!, functionName: "maxBorrow", args: [id]}),
              client.readContract({abi: vaultAbi, address: addresses.vault!, functionName: "availableToBorrow", args: [id]}),
              client.readContract({abi: vaultAbi, address: addresses.vault!, functionName: "isDefaulted", args: [id]}),
            ]);
            return {id, r, slot, debt, cap, drawable, defaulted};
          }),
        );

        const [poolTotal, poolIdle] = await Promise.all([
          client.readContract({abi: vaultAbi, address: addresses.vault!, functionName: "totalAssets"}),
          client.readContract({abi: vaultAbi, address: addresses.vault!, functionName: "totalIdle"}),
        ]);

        if (cancelled) return;

        const positions: Position[] = reads.map((x) => {
          const reg = registered.find((l) => l.args.id === x.id)!;
          const r = x.r as {debtor: Address; faceValue: bigint; dueDate: bigint; docHash: `0x${string}`};
          const slot = x.slot as {
            owner: Address; underwriter: Address; open: boolean;
            floor: bigint; escrow: bigint; premiumReserve: bigint;
          };
          const debt = x.debt as bigint;
          const cap = x.cap as bigint;
          const floor = slot.floor;

          const days = Math.round((Number(r.dueDate) * 1000 - Date.now()) / 86_400_000);
          const coverage = debt > 0n ? Number((floor * 1000n) / debt) / 1000 : Infinity;
          const utilisation = cap > 0n ? Number((debt * 10000n) / cap) / 100 : 0;
          const advance = r.faceValue > 0n ? Number((floor * 10000n) / r.faceValue) / 100 : 0;
          const bid = slot.underwriter !== ZERO;

          const status: Position["status"] = x.defaulted
            ? "DEFAULT"
            : !slot.open
              ? "CLOSED"
              : !bid
                ? "UNPRICED"
                : debt === 0n
                  ? "PRICED"
                  : coverage < COVERAGE_THRESHOLD
                    ? "BREACH"
                    : days <= MATURITY_WINDOW_DAYS
                      ? "MATURING"
                      : "DRAWN";

          return {
            id: x.id, owner: reg.args.owner!, obligor: r.debtor, docHash: r.docHash,
            face: r.faceValue, dueDate: r.dueDate, floor, escrow: slot.escrow,
            premiumReserve: slot.premiumReserve, underwriter: slot.underwriter,
            open: slot.open, debt, cap, drawable: x.drawable as bigint,
            defaulted: x.defaulted as boolean, days, coverage, utilisation, advance, status,
          };
        });

        const audit: AuditEvent[] = [
          ...registered.map((l) => ({
            block: l.blockNumber!, hash: l.transactionHash!, actor: l.args.owner!,
            action: "RECEIVABLE REGISTERED", contract: "AssetRegistry",
            detail: `asset #${l.args.id} · face ${l.args.faceValue}`,
          })),
          ...bids.map((l) => ({
            block: l.blockNumber!, hash: l.transactionHash!, actor: l.args.underwriter!,
            action: l.args.displaced === ZERO ? "BID PLACED" : "INCUMBENT DISPLACED",
            contract: "FirmBidMarket",
            detail: `asset #${l.args.assetId} · floor ${l.args.floor}`,
          })),
          ...borrows.map((l) => ({
            block: l.blockNumber!, hash: l.transactionHash!, actor: l.args.borrower!,
            action: "CREDIT DRAWN", contract: "LoanVault",
            detail: `asset #${l.args.assetId} · ${l.args.amount}`,
          })),
          ...repays.map((l) => ({
            block: l.blockNumber!, hash: l.transactionHash!, actor: l.args.payer!,
            action: l.args.closed ? "LOAN CLOSED" : "REPAYMENT", contract: "LoanVault",
            detail: `asset #${l.args.assetId} · ${l.args.amount}`,
          })),
          ...settles.map((l) => ({
            block: l.blockNumber!, hash: l.transactionHash!, actor: l.args.underwriter!,
            action: "SETTLEMENT EXECUTED", contract: "FirmBidMarket",
            detail: `asset #${l.args.assetId} · price ${l.args.price}`,
          })),
          ...deposits.map((l) => ({
            block: l.blockNumber!, hash: l.transactionHash!, actor: l.args.lender!,
            action: "CAPITAL SUPPLIED", contract: "LoanVault",
            detail: `${l.args.amount}`,
          })),
        ].sort((a, b) => Number(b.block - a.block));

        setState({
          loading: false, error: null, positions,
          bids: bids.map((l) => ({
            assetId: l.args.assetId!, underwriter: l.args.underwriter!,
            displaced: l.args.displaced!, floor: l.args.floor!,
            premiumRate: l.args.premiumRate!, block: l.blockNumber!, hash: l.transactionHash!,
          })),
          audit,
          pool: {
            total: poolTotal as bigint, idle: poolIdle as bigint,
            deployed: (poolTotal as bigint) - (poolIdle as bigint),
          },
          block,
        });
      } catch (err) {
        if (!cancelled) setState((s) => ({...s, loading: false, error: (err as Error).message}));
      }
    };

    read();
    const t = setInterval(read, 12_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return useMemo(() => ({...state, refresh}), [state, refresh]);
}

/** Portfolio aggregates. Every figure is a sum over real positions. */
export function usePortfolio(positions: Position[]) {
  return useMemo(() => {
    const face = positions.reduce((a, p) => a + p.face, 0n);
    const floors = positions.reduce((a, p) => a + p.floor, 0n);
    const debt = positions.reduce((a, p) => a + p.debt, 0n);
    const cap = positions.reduce((a, p) => a + p.cap, 0n);
    const available = positions.reduce((a, p) => a + p.drawable, 0n);
    const atRisk = positions
      .filter((p) => p.status === "BREACH" || p.status === "DEFAULT")
      .reduce((a, p) => a + p.debt, 0n);

    const ltv = face > 0n ? Number((debt * 10000n) / face) / 100 : 0;
    const coverage = debt > 0n ? Number((floors * 10000n) / debt) / 100 : 100;

    // Weight maturity by face value, the way a credit desk would.
    const weightedDays =
      face > 0n
        ? positions.reduce((a, p) => a + p.days * Number(p.face / 10n ** 15n), 0) /
          Number(face / 10n ** 15n)
        : 0;

    const byObligor = new Map<string, bigint>();
    for (const p of positions) {
      byObligor.set(p.obligor, (byObligor.get(p.obligor) ?? 0n) + p.face);
    }
    const exposure = [...byObligor.entries()]
      .map(([addr, amt]) => ({
        addr, amount: amt,
        share: face > 0n ? Number((amt * 10000n) / face) / 100 : 0,
      }))
      .sort((a, b) => Number(b.amount - a.amount));

    const buckets = [
      {label: "0-30 DAYS", min: -Infinity, max: 30},
      {label: "31-60 DAYS", min: 30, max: 60},
      {label: "61-90 DAYS", min: 60, max: 90},
      {label: "90+ DAYS", min: 90, max: Infinity},
    ].map((b) => ({
      label: b.label,
      amount: positions
        .filter((p) => p.days > b.min && p.days <= b.max)
        .reduce((a, p) => a + p.face, 0n),
    }));

    return {face, floors, debt, cap, available, atRisk, ltv, coverage, weightedDays, exposure, buckets};
  }, [positions]);
}

/** Everything requiring an operator decision, ranked. */
export function useWorkQueue(positions: Position[]) {
  return useMemo(() => {
    const items = positions.flatMap((p) => {
      const out: {
        priority: "HIGH" | "MED" | "LOW";
        id: bigint; type: string; desk: string; detail: string; position: Position;
      }[] = [];

      if (p.status === "DEFAULT")
        out.push({priority: "HIGH", id: p.id, type: "SETTLEMENT", desk: "SERVICING",
          detail: "callable now - escrow settles to the lender", position: p});
      else if (p.status === "BREACH")
        out.push({priority: "HIGH", id: p.id, type: "COVERAGE", desk: "CREDIT",
          detail: `coverage ${p.coverage.toFixed(2)}x against a ${COVERAGE_THRESHOLD}x policy`, position: p});
      else if (p.status === "MATURING")
        out.push({priority: "MED", id: p.id, type: "MATURITY", desk: "SERVICING",
          detail: `settles in ${p.days} days`, position: p});

      if (p.open && p.underwriter === ZERO)
        out.push({priority: "MED", id: p.id, type: "UNDERWRITE", desk: "AGENT",
          detail: "no firm bid - not financeable until priced", position: p});

      if (!p.open && p.debt === 0n)
        out.push({priority: "LOW", id: p.id, type: "ORIGINATION", desk: "OPS",
          detail: "registered but not opened for bidding", position: p});

      return out;
    });

    const rank = {HIGH: 0, MED: 1, LOW: 2};
    return items.sort((a, b) => rank[a.priority] - rank[b.priority] || Number(a.id - b.id));
  }, [positions]);
}

/** Per-desk aggregates, assembled from BidPlaced logs and current slots. */
export function useDesks(positions: Position[], bids: BidEvent[]) {
  const [capital, setCapital] = useState<Record<string, bigint>>({});

  useEffect(() => {
    if (!addresses.stable) return;
    const client = createPublicClient({chain: botChain, transport: http()});
    const desks = [...new Set(bids.map((b) => b.underwriter.toLowerCase()))];
    if (desks.length === 0) return;

    Promise.all(
      desks.map(async (d) => [
        d,
        (await client.readContract({
          abi: erc20Abi, address: addresses.stable!, functionName: "balanceOf", args: [d as Address],
        })) as bigint,
      ]),
    )
      .then((rows) => setCapital(Object.fromEntries(rows as [string, bigint][])))
      .catch(() => undefined);
  }, [bids]);

  return useMemo(() => {
    const desks = [...new Set(bids.map((b) => b.underwriter.toLowerCase()))];
    return desks.map((d) => {
      const mine = bids.filter((b) => b.underwriter.toLowerCase() === d);
      const held = positions.filter((p) => p.underwriter.toLowerCase() === d);
      const displaced = bids.filter((b) => b.displaced.toLowerCase() === d).length;
      const escrowed = held.reduce((a, p) => a + p.escrow, 0n);
      const avgAdvance = held.length
        ? held.reduce((a, p) => a + p.advance, 0) / held.length
        : 0;

      return {
        address: d as Address,
        name: bookOf(d),
        capital: capital[d] ?? 0n,
        escrowed,
        bidsPlaced: mine.length,
        holding: held.length,
        displaced,
        avgAdvance,
        positions: held,
        events: mine,
      };
    });
  }, [positions, bids, capital]);
}
