// Module 12: append-only audit log with a tamper-evident hash chain.
// The hash is a fast non-cryptographic demo hash; production would use SHA-256 and write-once storage.
import { hashStr } from "./rng";

export type AuditType =
  | "APPLICATION_SUBMITTED"
  | "KYC_COMPLETED"
  | "DECISION"
  | "REVIEW_RESOLVED"
  | "OVERRIDE"
  | "POLICY_PUBLISHED"
  | "AI_OUTPUT"
  | "DEMO_RESET";

export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  actorType: "system" | "human" | "ai";
  type: AuditType;
  ref: string;
  summary: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export type AuditInput = Omit<AuditEntry, "seq" | "prevHash" | "hash">;

function digest(s: string): string {
  return hashStr(s).toString(16).padStart(8, "0") + hashStr("k" + s).toString(16).padStart(8, "0");
}

function entryHash(e: Omit<AuditEntry, "hash">): string {
  return digest(JSON.stringify([e.seq, e.at, e.actor, e.actorType, e.type, e.ref, e.summary, e.payload, e.prevHash]));
}

export const GENESIS = "0000000000000000";

export function appendAudit(log: AuditEntry[], input: AuditInput): AuditEntry {
  const prev = log[log.length - 1];
  const base = { ...input, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? GENESIS };
  const entry = { ...base, hash: entryHash(base) };
  log.push(entry);
  return entry;
}

export function verifyChain(log: AuditEntry[]): { ok: boolean; brokenAt?: number } {
  let prev = GENESIS;
  for (const e of log) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || entryHash(rest) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true };
}
