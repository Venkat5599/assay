import localFont from "next/font/local";

/**
 * Self-hosted, licensed type. Deliberately off the free-Google shelf, which
 * is where every other project on this chain will land.
 *
 * Supreme carries the display voice - a grotesque with actual quirks in the
 * R and G, so a headline reads as a decision rather than a default. Switzer
 * is the quiet workhorse underneath it. Commit Mono handles every label,
 * figure and diagram, which on this page is most of the type.
 */

export const display = localFont({
  src: [
    {path: "./fonts/Supreme-Bold.woff2", weight: "700", style: "normal"},
    {path: "./fonts/Supreme-Extrabold.woff2", weight: "800", style: "normal"},
  ],
  variable: "--font-display",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const body = localFont({
  src: [
    {path: "./fonts/Switzer-Regular.woff2", weight: "400", style: "normal"},
    {path: "./fonts/Switzer-Medium.woff2", weight: "500", style: "normal"},
    {path: "./fonts/Switzer-Semibold.woff2", weight: "600", style: "normal"},
  ],
  variable: "--font-body",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

export const mono = localFont({
  src: [
    {path: "./fonts/CommitMono-Regular.otf", weight: "400", style: "normal"},
    {path: "./fonts/CommitMono-Bold.otf", weight: "700", style: "normal"},
  ],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});
