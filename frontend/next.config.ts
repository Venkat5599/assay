import type {NextConfig} from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Lockfile lives beside this app, not at the drive root.
  turbopack: {root: __dirname},
  // The app is entirely client-side: no server actions, no route handlers, no
  // image optimisation. It exports to static files without losing anything,
  // which is also what lets it deploy from a repository root that is not the
  // app root.
  output: "export",
  images: {unoptimized: true},
};

export default config;
