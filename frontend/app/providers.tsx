"use client";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {useState, type ReactNode} from "react";
import {WagmiProvider, createConfig, http} from "wagmi";
import {injected} from "wagmi/connectors";

import {botChain} from "@/lib/chain";

const config = createConfig({
  chains: [botChain],
  connectors: [injected()],
  transports: {[botChain.id]: http()},
  ssr: true,
});

export function Providers({children}: {children: ReactNode}) {
  const [qc] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
