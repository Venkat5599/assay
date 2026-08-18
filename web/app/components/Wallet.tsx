"use client";

import {useAccount, useConnect, useDisconnect, useSwitchChain} from "wagmi";

import {botChain} from "@/lib/chain";
import {shortAddress} from "@/lib/format";

export function Wallet() {
  const {address, isConnected, chainId} = useAccount();
  const {connect, connectors, isPending} = useConnect();
  const {disconnect} = useDisconnect();
  const {switchChain} = useSwitchChain();

  if (!isConnected) {
    const injected = connectors[0];
    return (
      <button
        className="btn flare"
        disabled={!injected || isPending}
        onClick={() => injected && connect({connector: injected})}
      >
        {isPending ? "CONNECTING" : "CONNECT WALLET"}
        <span aria-hidden="true">&gt;</span>
      </button>
    );
  }

  if (chainId !== botChain.id) {
    return (
      <button className="btn flare" onClick={() => switchChain({chainId: botChain.id})}>
        SWITCH TO BOT CHAIN
        <span aria-hidden="true">&gt;</span>
      </button>
    );
  }

  return (
    <button className="btn onDark" onClick={() => disconnect()}>
      {shortAddress(address)}
      <span aria-hidden="true">x</span>
    </button>
  );
}
