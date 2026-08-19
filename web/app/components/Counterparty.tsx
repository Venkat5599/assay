"use client";

import {useEffect, useState} from "react";
import {keccak256, stringToHex, type Address} from "viem";
import {useAccount, usePublicClient} from "wagmi";

import {Field, Result} from "./Forms";
import {counterpartyAbi} from "@/lib/abi";
import {addresses} from "@/lib/addresses";
import {useTxRunner} from "@/lib/useChain";
import {ROLE, STATUS} from "@/lib/useOntology";

/**
 * Writing to the counterparty ontology.
 *
 * The registry shipped, deployed, and rendered a table - with no way to put
 * anything in it. It stayed empty, so every obligor in the console rendered as
 * a bare address, and "0x0000...dEaD holds 31.7% of face" is not an exposure
 * report a credit desk can act on.
 *
 * Two separate acts, and they must not collapse into one. Registering an entity
 * records a claim about the real world. Verifying it is a registrar asserting
 * that claim has been checked. Neither is cryptographic - the document hash on
 * the receivable is the commitment, and this is the social layer beside it, so
 * the UI keeps the two visibly apart rather than letting a name inherit the
 * authority of a hash.
 */

export function RegisterCounterparty({onDone}: {onDone?: () => void}) {
  const {address, isConnected} = useAccount();
  const publicClient = usePublicClient();
  const runner = useTxRunner();

  const [account, setAccount] = useState("");
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("US");
  const [role, setRole] = useState(1); // Shipper
  const [evidence, setEvidence] = useState("");
  const [isRegistrar, setIsRegistrar] = useState<boolean | null>(null);

  const busy = runner.state.status === "pending";

  // Only a registrar can write here, and finding that out from a revert is a
  // poor way to learn it.
  useEffect(() => {
    if (!address || !addresses.counterparty || !publicClient) return;
    let off = false;
    publicClient
      .readContract({
        abi: counterpartyAbi,
        address: addresses.counterparty,
        functionName: "isRegistrar",
        args: [address],
      })
      .then((v) => {
        if (!off) setIsRegistrar(v as boolean);
      })
      .catch(() => undefined);
    return () => {
      off = true;
    };
  }, [address, publicClient]);

  const valid =
    isConnected && /^0x[0-9a-fA-F]{40}$/.test(account) && name.trim().length > 0;

  if (!addresses.counterparty) {
    return (
      <p className="callout">
        <b>No counterparty registry configured in this build.</b> Obligors will render as
        addresses.
      </p>
    );
  }

  return (
    <div className="form">
      <div className="form-head">
        <h3>Record a counterparty</h3>
        <span className="num">REGISTRAR</span>
      </div>
      <p className="form-lead">
        Names the entity behind an obligor address. Recording is not verifying &mdash; an entity
        enters as <span className="mono">Pending</span> and a registrar promotes it separately,
        because naming something is not the same as having checked it.
      </p>

      <div className="formgrid">
        <Field label="Address" hint="The obligor address a receivable points at">
          <input
            className="input"
            placeholder="0x..."
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            spellCheck={false}
          />
        </Field>
        <Field label="Legal name" hint="As it appears on the paperwork">
          <input
            className="input"
            placeholder="Midwest Grain Cooperative"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Role" hint="What this party does in the trade">
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(Number(e.target.value))}
          >
            {ROLE.map((r, i) => (
              <option key={r} value={i}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Jurisdiction" hint="ISO 3166-1 alpha-2, or a region">
          <input
            className="input"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Evidence reference"
        hint={
          evidence.trim()
            ? `hashes to ${keccak256(stringToHex(evidence.trim())).slice(0, 22)}...`
            : "Optional. Any stable string identifying the evidence bundle"
        }
      >
        <input
          className="input"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          spellCheck={false}
        />
      </Field>

      <button
        className="btn flare"
        disabled={!valid || busy || isRegistrar === false}
        onClick={async () => {
          const ok = await runner.run([
            {
              label: `Recording ${name.trim()}`,
              call: () =>
                runner.writeContractAsync({
                  abi: counterpartyAbi,
                  address: addresses.counterparty!,
                  functionName: "register",
                  args: [
                    account as Address,
                    name.trim(),
                    role,
                    jurisdiction.trim(),
                    evidence.trim()
                      ? keccak256(stringToHex(evidence.trim()))
                      : ("0x" + "0".repeat(64)) as `0x${string}`,
                  ],
                }),
            },
          ]);
          if (ok) {
            setAccount("");
            setName("");
            setEvidence("");
            onDone?.();
          }
        }}
      >
        {busy ? "Recording" : "Record as pending"} <span aria-hidden="true">&gt;</span>
      </button>

      {isRegistrar === false && (
        <p className="formnote">
          This wallet is not a registrar. The registry owner grants the role with{" "}
          <span className="mono">setRegistrar</span>; reads stay open to everyone.
        </p>
      )}
      <Result runner={runner} />
    </div>
  );
}

/**
 * Promote or restrict an entity that is already recorded.
 *
 * Deliberately its own control. Verification is a governance statement, and
 * folding it into the registration form would make it look like a property of
 * the name rather than a decision somebody took about it.
 */
export function SetCounterpartyStatus({
  entities,
  onDone,
}: {
  entities: {address: Address; name: string; status: string}[];
  onDone?: () => void;
}) {
  const {isConnected} = useAccount();
  const runner = useTxRunner();
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState(2); // Verified
  const busy = runner.state.status === "pending";

  if (entities.length === 0) return null;

  return (
    <div className="form">
      <div className="form-head">
        <h3>Verification status</h3>
        <span className="num">GOVERNANCE CLAIM</span>
      </div>
      <p className="form-lead">
        A registrar asserting an entity is who it says. This is not a proof and the console never
        presents it as one &mdash; the cryptographic commitment in this protocol is the document
        hash on the receivable.
      </p>

      <div className="formgrid">
        <Field label="Entity" hint="Already recorded on chain">
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Select...</option>
            {entities.map((e) => (
              <option key={e.address} value={e.address}>
                {e.name} — {e.status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="New status" hint="Restricted blocks participation">
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(Number(e.target.value))}
          >
            {STATUS.map((sName, i) => (
              <option key={sName} value={i}>
                {sName}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <button
        className="btn onDark"
        disabled={!isConnected || busy || !target}
        onClick={async () => {
          const ok = await runner.run([
            {
              label: "Updating status",
              call: () =>
                runner.writeContractAsync({
                  abi: counterpartyAbi,
                  address: addresses.counterparty!,
                  functionName: "setStatus",
                  args: [target as Address, status],
                }),
            },
          ]);
          if (ok) onDone?.();
        }}
      >
        {busy ? "Updating" : "Set status"}
      </button>
      <Result runner={runner} />
    </div>
  );
}
