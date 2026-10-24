import { createHash } from "node:crypto";
import { canonicalJson, type RepairEvidenceBundle } from "./repair";

/** Server-only hashing helpers (node:crypto), kept out of the client-safe main entry. */

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** SHA-256 of the canonical JSON of an evidence bundle: reproducible from the stored bundle alone. */
export function evidenceChecksum(bundle: RepairEvidenceBundle): string {
  return sha256Hex(canonicalJson(bundle));
}
