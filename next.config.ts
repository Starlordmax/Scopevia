import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pins the workspace root to this project. Without this, Next.js walks up
  // the filesystem looking for lockfiles and can pick an unrelated ancestor
  // directory (e.g. a stray package-lock.json elsewhere on this machine) as
  // the root, which silently breaks file tracing.
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
