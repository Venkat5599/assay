"use client";

import {useEffect, useState} from "react";
import {maxUint256} from "viem";
import {useAccount, usePublicClient} from "wagmi";

import {Field, Result} from "./Forms";
import {erc20Abi, marketAbi, vaultAbi} from "@/lib/abi";
import {addresses} from "@/lib/addresses";
import {useToken, useTxRunner} from "@/lib/useChain";
import {toUnits, usd} from "@/lib/format";

/**
 * The exits.
 *
 * Every control here moves capital OUT of the protocol, and each one existed on
 * chain long before it existed in the product. That gap was the real hole in
 * this build: money could enter the system through four different surfaces and
 * leave it through none of them. A credit protocol that only takes deposits is
 * not a complete loop, whatever its contracts can do.
 *
 * Kept in their own module because they share a shape - read what you are owed,
 * show the bound the contract will enforce, then let the user take it - and
 * because none of them should be buried inside a form about something else.
 */

type Step = {label: string; call: () => Promise<`0x${string}`>};

/**
 * Lender exit.
 *
 * Withdrawal is bounded by idle cash rather than by pool value, because lent
 * capital is genuinely illiquid until a loan is repaid or a default settles. A
 * pool that pretends otherwise lets the first lender out drain the buffer every
 * borrower depends on. The bound is shown here, not discovered on a revert.
 */
export function WithdrawPanel({idle}: {idle?: bigint}) {
  const {address, isConnected} = useAccount();
  const runner = useTxRunner();
  const publicClient = usePublicClient();
  const [shares, setShares] = useState<bigint>();
  const [value, setValue] = useState<bigint>();
  const busy = runner.state.status === "pending";

  useEffect(() => {
    if (!address || !addresses.vault || !publicClient) return;
    let off = false;
    const read = async () => {
      const sh = (await publicClient.readContract({
        abi: vaultAbi,
        address: addresses.vault!,
        functionName: "sharesOf",
        args: [address],
      })) as bigint;
      const val = (await publicClient.readContract({
        abi: vaultAbi,
        address: addresses.vault!,
        functionName: "convertToAssets",
        args: [sh],
      })) as bigint;
      if (!off) {
        setShares(sh);
        setValue(val);
      }
    };
    read().catch(() => undefined);
    const t = setInterval(() => read().catch(() => undefined), 8000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [address, publicClient, runner.state.status]);

  const nothing = !shares || shares === 0n;
  const capped = value !== undefined && idle !== undefined && value > idle;

  return (
    <div className="form">
      <div className="form-head">
        <h3>Withdraw</h3>
        <span className="num">LENDER</span>
      </div>
      <dl className="kv">
        <div>
          <dt>Your position</dt>
          <dd>{usd(value)}</dd>
        </div>
        <div>
          <dt>Withdrawable now</dt>
          <dd>{capped ? usd(idle) : usd(value)}</dd>
        </div>
      </dl>
      {capped && (
        <p className="formnote">
          Idle cash bounds this. The rest is lent out and comes back as borrowers repay or
          positions settle.
        </p>
      )}
      <button
        className="btn onDark"
        disabled={!isConnected || busy || nothing}
        onClick={() =>
          runner.run([
            {
              label: "Redeeming shares",
              call: () =>
                runner.writeContractAsync({
                  abi: vaultAbi,
                  address: addresses.vault!,
                  functionName: "withdraw",
                  args: [shares!],
                }),
            },
          ])
        }
      >
        {busy ? "Redeeming" : nothing ? "No position" : "Withdraw " + usd(value)}
      </button>
      <Result runner={runner} />
    </div>
  );
}

/**
 * Carrier collects what a settlement left over.
 *
 * When a default settles, the underwriter buys at the standing floor, the
 * lenders are made whole first, and anything above the debt belongs to the
 * carrier who owned the equity above it. The vault computed that surplus
 * correctly from the first commit and gave nobody any way to take it.
 */
export function ClaimSurplus() {
  const {address, isConnected} = useAccount();
  const runner = useTxRunner();
  const publicClient = usePublicClient();
  const [amount, setAmount] = useState<bigint>();
  const busy = runner.state.status === "pending";

  useEffect(() => {
    if (!address || !addresses.vault || !publicClient) return;
    let off = false;
    const read = async () => {
      const a = (await publicClient.readContract({
        abi: vaultAbi,
        address: addresses.vault!,
        functionName: "claimable",
        args: [address],
      })) as bigint;
      if (!off) setAmount(a);
    };
    read().catch(() => undefined);
    const t = setInterval(() => read().catch(() => undefined), 8000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [address, publicClient, runner.state.status]);

  const none = !amount || amount === 0n;

  return (
    <div className="form">
      <div className="form-head">
        <h3>Settlement surplus</h3>
        <span className="num">CARRIER</span>
      </div>
      <p className="form-lead">
        Sale proceeds above the outstanding debt belong to you, not to the pool. Default is
        never profitable for the lenders here.
      </p>
      <dl className="kv">
        <div>
          <dt>Owed to you</dt>
          <dd>{usd(amount)}</dd>
        </div>
      </dl>
      <button
        className="btn flare"
        disabled={!isConnected || busy || none}
        onClick={() =>
          runner.run([
            {
              label: "Claiming surplus",
              call: () =>
                runner.writeContractAsync({
                  abi: vaultAbi,
                  address: addresses.vault!,
                  functionName: "claimSurplus",
                }),
            },
          ])
        }
      >
        {busy ? "Claiming" : none ? "Nothing to claim" : "Claim " + usd(amount)}{" "}
        <span aria-hidden="true">&gt;</span>
      </button>
      <Result runner={runner} />
    </div>
  );
}

/**
 * Underwriter exits. Two separate acts, deliberately.
 *
 * Claiming premium takes the income earned so far and leaves the commitment
 * standing. Withdrawing the bid ends the commitment and returns the escrow, and
 * the contract refuses it while a loan is open against the slot: an underwriter
 * cannot walk away from collateral a lender is currently relying on.
 */
export function UnderwriterExit({
  assetId,
  accrued,
  escrow,
  hasDebt,
  isIncumbent,
  onDone,
}: {
  assetId: bigint;
  accrued?: bigint;
  escrow?: bigint;
  hasDebt: boolean;
  isIncumbent: boolean;
  onDone?: () => void;
}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const busy = runner.state.status === "pending";

  const fire = async (label: string, fn: "claimPremium" | "withdrawBid") => {
    const ok = await runner.run([
      {
        label,
        call: () =>
          runner.writeContractAsync({
            abi: marketAbi,
            address: addresses.market!,
            functionName: fn,
            args: [assetId],
          }),
      },
    ]);
    if (ok) onDone?.();
  };

  return (
    <div className="form">
      <div className="form-head">
        <h3>Your commitment</h3>
        <span className="num">UNDERWRITER</span>
      </div>

      {!isIncumbent ? (
        <p className="form-lead">
          You do not hold this slot. Only the standing underwriter can claim premium or
          withdraw the escrow behind it.
        </p>
      ) : (
        <>
          <dl className="kv">
            <div>
              <dt>Escrow held</dt>
              <dd>{usd(escrow)}</dd>
            </div>
            <div>
              <dt>Premium earned</dt>
              <dd>{usd(accrued)}</dd>
            </div>
          </dl>
          <div className="btnrow">
            <button
              className="btn flare"
              disabled={!isConnected || busy || !accrued}
              onClick={() => fire("Claiming premium", "claimPremium")}
            >
              {busy ? "Working" : "Claim premium"}
            </button>
            <button
              className="btn onDark"
              disabled={!isConnected || busy || hasDebt}
              onClick={() => fire("Withdrawing the bid", "withdrawBid")}
            >
              Withdraw bid
            </button>
          </div>
          {hasDebt && (
            <p className="formnote">
              A loan is open against this slot. The escrow is what makes that loan safe, so it
              cannot leave until the debt clears or the position settles.
            </p>
          )}
        </>
      )}
      <Result runner={runner} />
    </div>
  );
}

/**
 * Carrier tops up the premium reserve, or closes the slot entirely.
 *
 * The reserve is what pays the standing underwriter. Let it run dry and accrual
 * simply stops, which is the borrower quietly ceasing to pay for a commitment
 * they are still relying on. Closing returns the collateral and any unspent
 * reserve, and the contract refuses it while a bid stands or a loan is open.
 */
export function SlotAdmin({
  assetId,
  premiumReserve,
  hasIncumbent,
  hasDebt,
  onDone,
}: {
  assetId: bigint;
  premiumReserve?: bigint;
  hasIncumbent: boolean;
  hasDebt: boolean;
  onDone?: () => void;
}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const {allowance} = useToken(addresses.market);
  const [top, setTop] = useState("");
  const busy = runner.state.status === "pending";
  const topWei = toUnits(top);

  const fund = async () => {
    const steps: Step[] = [];
    if ((allowance ?? 0n) < topWei) {
      steps.push({
        label: "Approving the market",
        call: () =>
          runner.writeContractAsync({
            abi: erc20Abi,
            address: addresses.stable!,
            functionName: "approve",
            args: [addresses.market!, maxUint256],
          }),
      });
    }
    steps.push({
      label: "Funding the reserve",
      call: () =>
        runner.writeContractAsync({
          abi: marketAbi,
          address: addresses.market!,
          functionName: "fundPremium",
          args: [assetId, topWei],
        }),
    });
    if (await runner.run(steps)) onDone?.();
  };

  const close = async () => {
    const ok = await runner.run([
      {
        label: "Closing the slot",
        call: () =>
          runner.writeContractAsync({
            abi: marketAbi,
            address: addresses.market!,
            functionName: "closeSlot",
            args: [assetId],
          }),
      },
    ]);
    if (ok) onDone?.();
  };

  return (
    <div className="form">
      <div className="form-head">
        <h3>Premium reserve</h3>
        <span className="num">{usd(premiumReserve)} LEFT</span>
      </div>
      <p className="form-lead">
        The reserve streams to whoever holds the standing bid. If it empties, accrual stops and
        the commitment is no longer being paid for.
      </p>
      <Field label="Top up (USDT)" hint="Added to the reserve immediately">
        <input
          className="input"
          inputMode="decimal"
          value={top}
          onChange={(e) => setTop(e.target.value)}
        />
      </Field>
      <div className="btnrow">
        <button className="btn flare" disabled={!isConnected || busy || topWei === 0n} onClick={fund}>
          {busy ? "Working" : "Fund reserve"}
        </button>
        <button
          className="btn onDark"
          disabled={!isConnected || busy || hasIncumbent || hasDebt}
          onClick={close}
        >
          Close slot
        </button>
      </div>
      {(hasIncumbent || hasDebt) && (
        <p className="formnote">
          {hasDebt
            ? "A loan is open against this receivable."
            : "An underwriter holds this slot; they must withdraw before it can close."}{" "}
          Closing returns the collateral and any unspent reserve.
        </p>
      )}
      <Result runner={runner} />
    </div>
  );
}
