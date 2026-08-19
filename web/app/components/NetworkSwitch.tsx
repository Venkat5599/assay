"use client";

import {useEffect, useState} from "react";

import {ACTIVE, DEPLOYMENTS, switchNetwork, type Deployment} from "@/lib/networks";

/**
 * Switch which deployment the console is reading.
 *
 * Mainnet settles in an asset LADING does not issue, so the loop there costs
 * real money to exercise. Testnet settles in a token anyone can mint. Both are
 * live, and a visitor who wants to click through the whole thing should not
 * need a different build to do it.
 *
 * Switching reloads the page. Addresses and settlement precision are resolved
 * once at module scope, and swapping them underneath a mounted tree would leave
 * half the screen reading one chain and half the other - a reload is the honest
 * cost of changing which chain you are looking at, and it is one the user asked
 * for explicitly.
 *
 * Rendered only after mount: the server has no localStorage, so it always
 * renders the build default, and painting that first would flash the wrong
 * network at anyone who has chosen the other one.
 */
export function NetworkSwitch({compact = false}: {compact?: boolean}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options = Object.values(DEPLOYMENTS);

  // Reserve the space before mount so nothing below it shifts when it appears.
  if (!mounted) {
    return <span className={compact ? "netsw compact" : "netsw"} aria-hidden="true" />;
  }

  return (
    <span className={compact ? "netsw compact" : "netsw"} role="group" aria-label="Network">
      {options.map((d: Deployment) => {
        const on = d.key === ACTIVE.key;
        return (
          <button
            key={d.key}
            className={on ? "netsw-opt on" : "netsw-opt"}
            aria-pressed={on}
            onClick={() => !on && switchNetwork(d.key)}
            title={
              on
                ? `Reading ${d.name} (chain ${d.id}), settling in ${d.symbol}`
                : `Switch to ${d.name} — reloads the page`
            }
          >
            {d.short}
          </button>
        );
      })}
    </span>
  );
}

/** The active network, stated plainly. Used where a badge is wanted, not a control. */
export function NetworkBadge() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <span className={ACTIVE.key === "testnet" ? "netbadge testnet" : "netbadge"}>
      <span>
        <i aria-hidden="true" />
        {ACTIVE.name.toUpperCase()}
      </span>
      <em>
        CHAIN {ACTIVE.id} · SETTLES IN {ACTIVE.symbol}
      </em>
    </span>
  );
}
