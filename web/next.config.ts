import type {NextConfig} from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // Lockfile lives beside this app, not at the drive root.
  turbopack: {root: __dirname},
};

export default config;
