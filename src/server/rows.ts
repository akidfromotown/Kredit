// Mapping between database rows and domain objects, shared by every database adapter.
import type { AuditEntry, AuditInput } from "../engine/audit";
import type { Decision } from "../engine/decision";
import type { CreditPolicy } from "../engine/policy";
import type { Business } from "../engine/types";

export interface AuditRow {
  seq: number | string;
  at: string | Date;
  actor: string;
  actor_type: AuditEntry["actorType"];
  type: AuditEntry["type"];
  ref: string;
  summary: string;
  payload: unknown;
  prev_hash: string;
  hash: string;
}

export const rowToAudit = (r: AuditRow): AuditEntry => ({
  seq: Number(r.seq), at: new Date(r.at).toISOString(), actor: r.actor, actorType: r.actor_type, type: r.type,
  ref: r.ref, summary: r.summary, payload: r.payload, prevHash: r.prev_hash, hash: r.hash,
});

/** JSON body for kredit_append_audit and the other write functions. */
export const auditJson = (a: AuditInput[]) => a.map((e) => ({ at: e.at, actor: e.actor, actorType: e.actorType, type: e.type, ref: e.ref, summary: e.summary, payload: e.payload }));

export const rowToDecision = (r: { body: Decision; human: Decision["human"] | null }): Decision => ({ ...r.body, ...(r.human ? { human: r.human } : {}) });

export const policyRow = (p: CreditPolicy) => ({ version: p.version, published_at: p.publishedAt, published_by: p.publishedBy, note: p.note, body: p });
export const businessRow = (b: Business) => ({ id: b.id, source: b.source, name: b.name, applied_on: b.application.appliedOn, body: b });
export const decisionRow = (d: Decision) => {
  const { human, ...body } = d;
  return { id: d.id, business_id: d.businessId, policy_version: d.policyVersion, engine_outcome: d.engineOutcome, decided_at: d.decidedAt, body, human: human ?? null, human_at: human?.at ?? null };
};
