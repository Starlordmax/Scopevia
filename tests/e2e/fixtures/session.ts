import { readFileSync } from "node:fs";
import path from "node:path";
import { MANIFEST_PATH } from "../global-setup";
import type { E2EManifest } from "./provision";

const AUTH_DIR = path.join(__dirname, "..", "..", "..", "playwright", ".auth");

export function getManifest(): E2EManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

export type Persona = "owner-a" | "sales-a" | "viewer-a" | "field-worker-a" | "owner-b";

export function authFile(persona: Persona): string {
  return path.join(AUTH_DIR, `${persona}.json`);
}

/** A short, unique-enough suffix for naming records created within a single spec file run. */
export function uniqueSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
}
