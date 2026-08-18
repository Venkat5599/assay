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
        className="act"
        disabled={!injected || isPending}
        onClick={() => injected && connect({connector: injected})}
      >
        {isPending ? "CONNECTING" : "CONNECT WALLET"}
        <span className="caret">&rsaquo;</span>
      </button>
    );
  }

  if (chainId !== botChain.id) {
    return (
      <button className="act" onClick={() => switchChain({chainId: botChain.id})}>
        SWITCH TO BOT CHAIN
        <span className="caret">&rsaquo;</span>
      </button>
    );
  }

  return (
    <button className="act quiet" onClick={() => disconnect()}>
      {shortAddress(address)}
      <span className="caret">&times;</span>
    </button>
  );
}
