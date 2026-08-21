import type {Metadata, Viewport} from "next";

import "./globals.css";
import {body, display, mono} from "./fonts";
import {Motion} from "./components/Motion";
import {Providers} from "./providers";

export const metadata: Metadata = {
  title: "LADING - credit against freight that already moved",
  description:
    "A contestable market for firm bids on freight receivables. Underwriters escrow the purchase price before the loan exists, so default settles in one block with no auction, no oracle, and no secondary market.",
};

export const viewport: Viewport = {
  themeColor: "#0d0f0a",
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Motion />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
