import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Self-hosted by Next at build time — no runtime request to Google, no
// extra dependency beyond `next` itself (see docs/26-phase-1.6-ui-redesign.md
// for why Inter over adding the separate `geist` package).
const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Scopevia",
  description: "Scopevia — Smart Estimates for Contractors",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
