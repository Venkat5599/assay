"use client";

import {useState, type ReactNode} from "react";
import {keccak256, maxUint256, stringToHex, type Address} from "viem";
import {useAccount, usePublicClient} from "wagmi";

import {erc20Abi, marketAbi, registryAbi, vaultAbi} from "@/lib/abi";
import {addresses} from "@/lib/addresses";
import {explorerAddress, explorerTx} from "@/lib/chain";
import {useToken, useTxRunner} from "@/lib/useChain";
import {fromUnits, toUnits, usd} from "@/lib/format";

/**
 * The working surface.
 *
 * Every control here sends a real transaction to BOT Chain. Where a step needs
 * an allowance or an NFT approval first, the runner mines that step before the
 * next one is sent.
 */

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export function Result({runner}: {runner: ReturnType<typeof useTxRunner>}) {
  const s = runner.state;
  if (s.status === "idle") return null;
  if (s.status === "pending") return <p className="formnote">{s.label}&hellip;</p>;
  if (s.status === "error")
    return (
      <p className="formnote err">
        {s.message}
        <button className="linkish" onClick={runner.reset}>
          dismiss
        </button>
      </p>
    );
  return (
    <p className="formnote ok">
      Confirmed &mdash;{" "}
      <a href={explorerTx(s.hash)} target="_blank" rel="noreferrer">
        view transaction
      </a>
      <button className="linkish" onClick={runner.reset}>
        dismiss
      </button>
    </p>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * Where the settlement asset comes from.
 *
 * LADING settles in bridged USDT on BOT Chain - a real asset with real
 * liquidity, which is the entire point and also means there is no faucet. The
 * testnet build minted its own token on demand; on mainnet that button would be
 * a lie, so this panel tells you where the money actually comes from instead.
 */
export function GetUsdt() {
  const {isConnected} = useAccount();
  const {balance} = useToken();

  return (
    <div className="form">
      <div className="form-head">
        <h3>Settlement asset</h3>
        <span className="num">{isConnected ? `${usd(balance)} USDT` : "NOT CONNECTED"}</span>
      </div>
      <p className="form-lead">
        LADING settles in bridged USDT on BOT Chain, not a token this protocol issues. There is
        no faucet and nothing here is mintable &mdash; the asset is real, so it has to be
        acquired.
      </p>
      <dl className="kv">
        <div>
          <dt>Token</dt>
          <dd className="mono">
            {addresses.stable ? (
              <a href={explorerAddress(addresses.stable)} target="_blank" rel="noreferrer">
                {addresses.stable}
              </a>
            ) : (
              "not configured"
            )}
          </dd>
        </div>
        <div>
          <dt>Decimals</dt>
          <dd>6</dd>
        </div>
        <div>
          <dt>Bridge in</dt>
          <dd>
            <a href="https://bridge.botchain.ai/" target="_blank" rel="noreferrer">
              bridge.botchain.ai
            </a>
          </dd>
        </div>
        <div>
          <dt>Swap for</dt>
          <dd>
            <a href="https://dex.botchain.ai/" target="_blank" rel="noreferrer">
              dex.botchain.ai
            </a>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/**
 * Carrier: register a receivable and open it for bidding.
 *
 * The document hash is computed in the browser from the file you select - the
 * file itself never leaves the machine. Only the hash is committed on chain,
 * which is the whole point of a commitment.
 */
export function SubmitLoad({onDone}: {onDone?: () => void}) {
  const {address, isConnected} = useAccount();
  const publicClient = usePublicClient();
  const runner = useTxRunner();
  const {allowance} = useToken(addresses.market);

  const [debtor, setDebtor] = useState("");
  const [face, setFace] = useState("");
  const [days, setDays] = useState("60");
  const [premium, setPremium] = useState("400");
  const [reference, setReference] = useState("");
  const [fileHash, setFileHash] = useState<`0x${string}` | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const busy = runner.state.status === "pending";

  async function hashFile(file: File) {
    const buf = new Uint8Array(await file.arrayBuffer());
    setFileHash(keccak256(buf));
    setFileName(file.name);
  }

  const docHash: `0x${string}` | null =
    fileHash ?? (reference.trim() ? keccak256(stringToHex(reference.trim())) : null);

  const valid =
    isConnected &&
    /^0x[0-9a-fA-F]{40}$/.test(debtor) &&
    Number(face) > 0 &&
    Number(days) > 0 &&
    Number(premium) > 0 &&
    docHash !== null;

  async function submit() {
    const faceWei = toUnits(face);
    const premiumWei = toUnits(premium);
    const dueDate = BigInt(Math.floor(Date.now() / 1000) + Number(days) * 86_400);

    const steps: {label: string; call: () => Promise<`0x${string}`>}[] = [
      {
        label: "Registering the receivable",
        call: () =>
          runner.writeContractAsync({
            abi: registryAbi,
            address: addresses.assetRegistry!,
            functionName: "register",
            args: [
              address!,
              {
                debtor: debtor as Address,
                faceValue: faceWei,
                dueDate,
                registeredAt: 0n,
                docHash: docHash!,
              },
            ],
          }),
      },
    ];

    // The market escrows the collateral token and pulls the premium reserve,
    // so both approvals must be mined before openSlot is sent.
    steps.push({
      label: "Approving the market to hold the collateral",
      call: () =>
        runner.writeContractAsync({
          abi: registryAbi,
          address: addresses.assetRegistry!,
          functionName: "setApprovalForAll",
          args: [addresses.market!, true],
        }),
    });

    if ((allowance ?? 0n) < premiumWei) {
      steps.push({
        label: "Approving the premium reserve",
        call: () =>
          runner.writeContractAsync({
            abi: erc20Abi,
            address: addresses.stable!,
            functionName: "approve",
            args: [addresses.market!, maxUint256],
          }),
      });
    }


    // Opening the slot needs the id the registry just minted. Rather than
    // guess it or make the carrier come back for a second pass, read it out of
    // `idByDocHash` - the document hash is the key, and we already know it.
    // This step runs after the approvals above have mined, so the market can
    // take both the collateral and the reserve the moment the slot opens.
    steps.push({
      label: "Opening the bid slot",
      call: async () => {
        const id = (await publicClient!.readContract({
          abi: registryAbi,
          address: addresses.assetRegistry!,
          functionName: "idByDocHash",
          args: [docHash!],
        })) as bigint;
        if (id === 0n) throw new Error("registry did not record the document hash");
        return runner.writeContractAsync({
          abi: marketAbi,
          address: addresses.market!,
          functionName: "openSlot",
          args: [id, premiumWei],
        });
      },
    });

    const ok = await runner.run(steps);
    if (ok) onDone?.();
  }

  return (
    <div className="form">
      <div className="form-head">
        <h3>Submit a load</h3>
        <span className="num">CARRIER</span>
      </div>
      <p className="form-lead">
        Register the receivable on chain. The document stays on your machine; only its keccak256
        hash is committed, and duplicate hashes are rejected at registration.
      </p>

      <div className="formgrid">
        <Field label="Obligor address" hint="Who owes the invoice">
          <input
            className="input"
            placeholder="0x..."
            value={debtor}
            onChange={(e) => setDebtor(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label="Face value (tUSD)" hint="As invoiced">
          <input
            className="input"
            inputMode="decimal"
            placeholder="42000"
            value={face}
            onChange={(e) => setFace(e.target.value)}
          />
        </Field>
        <Field label="Terms (days)" hint="Days until the obligor settles">
          <input
            className="input"
            inputMode="numeric"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Field label="Premium reserve (tUSD)" hint="Funds the underwriter's premium">
          <input
            className="input"
            inputMode="decimal"
            value={premium}
            onChange={(e) => setPremium(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Document"
        hint={
          fileHash
            ? `${fileName} hashed to ${fileHash.slice(0, 22)}...`
            : "Attach the bill of lading, or type a reference below"
        }
      >
        <input
          className="input"
          type="file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) hashFile(f);
          }}
        />
      </Field>

      {!fileHash && (
        <Field
          label="Or a document reference"
          hint={docHash ? `hashes to ${docHash.slice(0, 22)}...` : "any stable string identifying the document"}
        >
          <input
            className="input"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            spellCheck={false}
          />
        </Field>
      )}

      <button className="btn flare" disabled={!valid || busy} onClick={submit}>
        {busy ? "Submitting" : "Register and open for bidding"}{" "}
        <span aria-hidden="true">&gt;</span>
      </button>
      <Result runner={runner} />
      {runner.state.status === "done" && (
        <p className="formnote">
          Registered and open for bidding. Underwriters can price it now.
        </p>
      )}
    </div>
  );
}

/** Opens bidding on an asset the connected wallet already owns. */
export function OpenSlot({assetId, onDone}: {assetId: bigint; onDone?: () => void}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const {allowance} = useToken(addresses.market);
  const [premium, setPremium] = useState("400");
  const busy = runner.state.status === "pending";

  async function submit() {
    const premiumWei = toUnits(premium);
    const steps: {label: string; call: () => Promise<`0x${string}`>}[] = [];

    if ((allowance ?? 0n) < premiumWei) {
      steps.push({
        label: "Approving the premium reserve",
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
      label: "Approving the market to hold the collateral",
      call: () =>
        runner.writeContractAsync({
          abi: registryAbi,
          address: addresses.assetRegistry!,
          functionName: "setApprovalForAll",
          args: [addresses.market!, true],
        }),
    });
    steps.push({
      label: "Opening the bid slot",
      call: () =>
        runner.writeContractAsync({
          abi: marketAbi,
          address: addresses.market!,
          functionName: "openSlot",
          args: [assetId, premiumWei],
        }),
    });

    if (await runner.run(steps)) onDone?.();
  }

  return (
    <div className="form">
      <div className="form-head">
        <h3>Open for bidding</h3>
        <span className="num">ASSET #{assetId.toString()}</span>
      </div>
      <Field label="Premium reserve (tUSD)" hint="Streams to whoever holds the standing bid">
        <input
          className="input"
          inputMode="decimal"
          value={premium}
          onChange={(e) => setPremium(e.target.value)}
        />
      </Field>
      <button
        className="btn flare"
        disabled={!isConnected || busy || Number(premium) <= 0}
        onClick={submit}
      >
        {busy ? "Opening" : "Open slot"} <span aria-hidden="true">&gt;</span>
      </button>
      <Result runner={runner} />
    </div>
  );
}

/** Underwrite: post a firm bid and escrow the price in full. */
export function PlaceBid({
  assetId,
  currentFloor,
  onDone,
}: {
  assetId: bigint;
  currentFloor?: bigint;
  onDone?: () => void;
}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const {balance, allowance} = useToken(addresses.market);
  const [floor, setFloor] = useState("");
  const [rate, setRate] = useState("1.0");
  const busy = runner.state.status === "pending";

  const floorWei = toUnits(floor);
  const beatsIncumbent = !currentFloor || floorWei > currentFloor;
  const affordable = balance === undefined || floorWei <= balance;

  async function submit() {
    const steps: {label: string; call: () => Promise<`0x${string}`>}[] = [];
    if ((allowance ?? 0n) < floorWei) {
      steps.push({
        label: "Approving the escrow",
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
      label: `Escrowing ${floor} tUSD and placing the bid`,
      call: () =>
        runner.writeContractAsync({
          abi: marketAbi,
          address: addresses.market!,
          functionName: "bid",
          // Rate is a per-block RAY fraction; 1.0 on this control is 1e15.
          args: [assetId, floorWei, BigInt(Math.round(Number(rate) * 1e15))],
        }),
    });
    if (await runner.run(steps)) onDone?.();
  }

  return (
    <div className="form">
      <div className="form-head">
        <h3>Post a firm bid</h3>
        <span className="num">UNDERWRITER</span>
      </div>
      <p className="form-lead">
        You are committing to buy this receivable at the price you set, and the full price is
        escrowed now. On default the invoice becomes yours.
      </p>
      <div className="formgrid">
        <Field
          label="Purchase price (tUSD)"
          hint={
            currentFloor
              ? `must beat the standing ${usd(currentFloor)}`
              : "no incumbent - any price opens the book"
          }
        >
          <input
            className="input"
            inputMode="decimal"
            placeholder="35000"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          />
        </Field>
        <Field label="Premium rate" hint="Per-block, RAY. 1.0 = 1e15">
          <input
            className="input"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </Field>
      </div>
      <button
        className="btn flare"
        disabled={!isConnected || busy || floorWei === 0n || !beatsIncumbent || !affordable}
        onClick={submit}
      >
        {busy ? "Escrowing" : `Escrow ${floor || "0"} and bid`}{" "}
        <span aria-hidden="true">&gt;</span>
      </button>
      {!affordable && <p className="formnote err">Balance is short. Mint tUSD first.</p>}
      {!beatsIncumbent && floorWei > 0n && (
        <p className="formnote err">Must beat the standing bid to displace the incumbent.</p>
      )}
      <Result runner={runner} />
    </div>
  );
}

/** Carrier: draw against the standing bid, or repay. */
export function BorrowRepay({
  assetId,
  drawable,
  debt,
  onDone,
}: {
  assetId: bigint;
  drawable?: bigint;
  debt?: bigint;
  onDone?: () => void;
}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const {allowance} = useToken(addresses.vault);
  const [draw, setDraw] = useState("");
  const [pay, setPay] = useState("");
  const busy = runner.state.status === "pending";

  const drawWei = toUnits(draw);
  const payWei = toUnits(pay);

  return (
    <div className="form">
      <div className="form-head">
        <h3>Draw and repay</h3>
        <span className="num">ASSET #{assetId.toString()}</span>
      </div>

      <div className="formgrid">
        <Field
          label="Draw (tUSD)"
          hint={
            <>
              up to {usd(drawable)}{" "}
              <button
                className="linkish"
                onClick={() => drawable && setDraw(fromUnits(drawable))}
              >
                max
              </button>
            </>
          }
        >
          <input
            className="input"
            inputMode="decimal"
            value={draw}
            onChange={(e) => setDraw(e.target.value)}
          />
        </Field>
        <Field
          label="Repay (tUSD)"
          hint={
            <>
              outstanding {usd(debt)}{" "}
              <button
                className="linkish"
                onClick={() => debt && setPay(fromUnits(debt))}
              >
                all
              </button>
            </>
          }
        >
          <input
            className="input"
            inputMode="decimal"
            value={pay}
            onChange={(e) => setPay(e.target.value)}
          />
        </Field>
      </div>

      <div className="btnrow">
        <button
          className="btn flare"
          disabled={!isConnected || busy || drawWei === 0n || (drawable !== undefined && drawWei > drawable)}
          onClick={async () => {
            const ok = await runner.run([
              {
                label: `Drawing ${draw} tUSD`,
                call: () =>
                  runner.writeContractAsync({
                    abi: vaultAbi,
                    address: addresses.vault!,
                    functionName: "borrow",
                    args: [assetId, drawWei],
                  }),
              },
            ]);
            if (ok) onDone?.();
          }}
        >
          {busy ? "Working" : "Draw"} <span aria-hidden="true">&gt;</span>
        </button>

        <button
          className="btn onDark"
          disabled={!isConnected || busy || payWei === 0n}
          onClick={async () => {
            const steps: {label: string; call: () => Promise<`0x${string}`>}[] = [];
            if ((allowance ?? 0n) < payWei) {
              steps.push({
                label: "Approving repayment",
                call: () =>
                  runner.writeContractAsync({
                    abi: erc20Abi,
                    address: addresses.stable!,
                    functionName: "approve",
                    args: [addresses.vault!, maxUint256],
                  }),
              });
            }
            steps.push({
              label: `Repaying ${pay} tUSD`,
              call: () =>
                runner.writeContractAsync({
                  abi: vaultAbi,
                  address: addresses.vault!,
                  functionName: "repay",
                  args: [assetId, payWei],
                }),
            });
            const ok = await runner.run(steps);
            if (ok) onDone?.();
          }}
        >
          Repay
        </button>
      </div>
      <Result runner={runner} />
    </div>
  );
}

/** Lender: supply the pool the carriers draw from. */
export function LendPanel() {
  const {address, isConnected} = useAccount();
  const runner = useTxRunner();
  const {balance, allowance} = useToken(addresses.vault);
  const [amount, setAmount] = useState("");
  const busy = runner.state.status === "pending";
  const amountWei = toUnits(amount);

  return (
    <div className="form">
      <div className="form-head">
        <h3>Supply the pool</h3>
        <span className="num">LENDER</span>
      </div>
      <p className="form-lead">
        Deposits fund carrier draws and earn interest. Withdrawals are bounded by idle cash,
        because lent capital is genuinely illiquid until repayment or settlement.
      </p>
      <Field
        label="Deposit (tUSD)"
        hint={
          <>
            balance {usd(balance)}{" "}
            <button
              className="linkish"
              onClick={() => balance && setAmount(fromUnits(balance))}
            >
              max
            </button>
          </>
        }
      >
        <input
          className="input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <button
        className="btn flare"
        disabled={!isConnected || busy || amountWei === 0n}
        onClick={() => {
          const steps: {label: string; call: () => Promise<`0x${string}`>}[] = [];
          if ((allowance ?? 0n) < amountWei) {
            steps.push({
              label: "Approving the vault",
              call: () =>
                runner.writeContractAsync({
                  abi: erc20Abi,
                  address: addresses.stable!,
                  functionName: "approve",
                  args: [addresses.vault!, maxUint256],
                }),
            });
          }
          steps.push({
            label: `Depositing ${amount} tUSD`,
            call: () =>
              runner.writeContractAsync({
                abi: vaultAbi,
                address: addresses.vault!,
                functionName: "deposit",
                args: [amountWei],
              }),
          });
          runner.run(steps);
        }}
      >
        {busy ? "Depositing" : "Deposit"} <span aria-hidden="true">&gt;</span>
      </button>
      <Result runner={runner} />
      {void address}
    </div>
  );
}

export {ZERO};

/** Executes an atomic settlement. Disabled until the contract says callable. */
export function SettleButton({
  assetId,
  enabled,
  onDone,
}: {
  assetId: bigint;
  enabled: boolean;
  onDone?: () => void;
}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const busy = runner.state.status === "pending";

  return (
    <div className="settle-exec">
      <button
        className="btn flare"
        disabled={!isConnected || !enabled || busy}
        onClick={async () => {
          const ok = await runner.run([
            {
              label: "Executing atomic settlement",
              call: () =>
                runner.writeContractAsync({
                  abi: marketAbi,
                  address: addresses.market!,
                  functionName: "settleDefault",
                  args: [assetId],
                }),
            },
          ]);
          if (ok) onDone?.();
        }}
      >
        {busy ? "Settling" : "Execute settlement"} <span aria-hidden="true">&gt;</span>
      </button>
      {!enabled && (
        <p className="formnote">
          The contract gates this until the receivable matures unpaid, or floor decay pulls
          coverage below the outstanding loan.
        </p>
      )}
      <Result runner={runner} />
    </div>
  );
}
