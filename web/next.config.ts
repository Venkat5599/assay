import type {NextConfig} from "next";

// GitHub Pages serves this repo from /assay, not from the domain root. The
// prefix is set only in the Pages build so `next dev` keeps working at /.
const basePath = process.env.PAGES_BASE_PATH ?? "";

const config: NextConfig = {
  reactStrictMode: true,
  // Lockfile lives beside this app, not at the drive root.
  turbopack: {root: __dirname},
  // The app is entirely client-side: no server actions, no route handlers, no
  // image optimisation. It exports to static files without losing anything.
  output: "export",
  basePath,
  assetPrefix: basePath || undefined,
  images: {unoptimized: true},
};

export default config;
