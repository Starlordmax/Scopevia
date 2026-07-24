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
  experimental: {
    serverActions: {
      // Next.js's own default (1 MB) is smaller than several file uploads
      // this app already advertises as supported — business logos up to
      // 2 MB (src/lib/branding/logo-validation.ts) and job/portfolio photos
      // up to 10 MB (src/lib/storage/media.ts). Any file over 1 MB was
      // being rejected by Next.js's own request parser BEFORE the Server
      // Action body ever ran, as an uncaught 413 that surfaced as the
      // generic "This page couldn't load" error boundary — no amount of
      // try/catch inside the action itself could ever have caught it. Set
      // to match the app's own largest already-documented limit, not a new
      // allowance.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
