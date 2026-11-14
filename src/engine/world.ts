// The demo "world": seeded history, user actions, the audit events each one produces, and the validation
// rules for human actions and policy publishing. Pure TypeScript shared by the browser (local mode),
// the seed script and the kredit-api Edge Function, so every path writes identical records.
import { appendAudit, type AuditEntry, type AuditInput } from "./audit";
import type { AiOutput } from "./assistant";
import { buildBusiness, generatePortfolio, INDUSTRIES, type NewBusinessInput } from "./data";
import { HUMAN_DECLINE_REASONS, decide, finalStatus, offerAtAmount, type Decision, type HumanAction } from "./decision";
import { kycOutcome } from "./kyc";
import { DEFAULT_POLICY, nextVersion, policyKey, type CreditPolicy } from "./policy";
import { Rng } from "./rng";
import type { Business } from "./types";

export type UserAction =
  | { t: "publish"; at: string; by: string; policy: CreditPolicy }
  | { t: "human"; at: string; businessId: string; human: HumanAction }
  | { t: "onboard"; at: string; input: NewBusinessInput }
  | { t: "ai"; at: string; ref: string; output: Pick<AiOutput, "task" | "title" | "body"> };

export interface World {
  businesses: Business[];
  policies: CreditPolicy[];
  decisions: Record<string, Decision>;
  audit: AuditEntry[];
}

export const CURRENT_USER = "you (demo credit officer)";
const ANALYSTS = ["j.alvarez (analyst)", "m.chen (analyst)", "r.okafor (senior analyst)"];

export const activePolicy = (w: Pick<World, "policies">) => w.policies[w.policies.length - 1];

// ---------------------------------------------------------------- audit events

export function intakeAudit(b: Business, at: string): AuditInput[] {
  const human = b.source === "onboarded";
  return [
    {
      at, actor: human ? CURRENT_USER : "applicant portal", actorType: human ? "human" : "system",
      type: "APPLICATION_SUBMITTED", ref: b.application.id,
      summary: `${b.name} applied for $${b.application.requestedAmount.toLocaleString("en-US")} / ${b.application.requestedTermMonths} mo`,
      payload: { businessId: b.id, application: b.application },
    },
    {
      at, actor: "kyc orchestrator (mock)", actorType: "system", type: "KYC_COMPLETED", ref: b.application.id,
      summary: `${b.name}: KYC/KYB ${kycOutcome(b.kyc)}`,
      payload: { businessId: b.id, checks: b.kyc },
    },
  ];
}

export function decisionAudit(d: Decision): AuditInput {
  return {
    at: d.decidedAt, actor: "decision engine", actorType: "system", type: "DECISION", ref: d.id,
    summary: `${d.businessName}: ${d.engineOutcome} · score ${d.score} (${d.band}) · ${d.policyVersion}`,
    payload: { businessId: d.businessId, applicationId: d.applicationId, policyVersion: d.policyVersion, inputs: d.inputs, knockouts: d.knockouts, score: d.score, band: d.band, offer: d.offer, outcome: d.engineOutcome, reasons: d.reasons },
  };
}

export function humanAudit(d: Decision, human: HumanAction): AuditInput {
  const before = finalStatus(d);
  return {
    at: human.at, actor: human.by, actorType: "human", type: human.kind === "override" ? "OVERRIDE" : "REVIEW_RESOLVED", ref: d.id,
    summary: `${d.businessName}: ${before} → ${human.action === "APPROVE" ? "APPROVED" : "DECLINED"} (${human.kind})`,
    payload: { decisionId: d.id, businessId: d.businessId, engineOutcome: d.engineOutcome, statusBefore: before, human },
  };
}

export function policyAudit(p: CreditPolicy): AuditInput {
  return { at: p.publishedAt, actor: p.publishedBy, actorType: "human", type: "POLICY_PUBLISHED", ref: p.version, summary: `${p.version} published: ${p.note}`, payload: p };
}

export function aiAudit(ref: string, out: Pick<AiOutput, "task" | "title" | "body">, at: string): AuditInput {
  return { at, actor: "kredit assistant (demo)", actorType: "ai", type: "AI_OUTPUT", ref, summary: `${out.title} (advisory only)`, payload: { task: out.task, title: out.title, body: out.body } };
}

// ---------------------------------------------------------------- validation (server and client)

export class ValidationError extends Error {}

/** Checks a proposed human action and returns it with server-computed terms. */
export function validateHuman(
  d: Decision,
  policy: CreditPolicy,
  input: { action: "APPROVE" | "DECLINE"; note: string; reasonCodes?: string[]; amount?: number },
  by: string,
  at: string,
): HumanAction {
  if (d.human) throw new ValidationError("This decision already has a human action.");
  const pending = finalStatus(d) === "PENDING_REVIEW";
  const kind: HumanAction["kind"] = pending ? "review" : "override";
  if (input.action !== "APPROVE" && input.action !== "DECLINE") throw new ValidationError("Action must be APPROVE or DECLINE.");
  if (!pending && input.action === d.engineOutcome) throw new ValidationError("An override must change the engine outcome.");
  const note = (input.note ?? "").trim();
  if (note.length < 10) throw new ValidationError("A justification of at least 10 characters is required.");
  if (input.action === "DECLINE") {
    const reasons = HUMAN_DECLINE_REASONS.filter((r) => input.reasonCodes?.includes(r.code));
    if (!reasons.length) throw new ValidationError("A decline needs at least one reason code.");
    return { by, at, kind, action: "DECLINE", reasons, note };
  }
  if (d.kycOutcome === "fail") throw new ValidationError("KYC / KYB failures cannot be approved.");
  const max = d.offer?.amount || d.inputs.application.requestedAmount;
  const amount = Math.round(Number(input.amount ?? max));
  if (!(amount >= policy.pricing.minLoan && amount <= max)) throw new ValidationError(`Amount must be between ${policy.pricing.minLoan} and ${max}.`);
  return { by, at, kind, action: "APPROVE", reasons: [], note, offer: offerAtAmount(policy, d, amount) };
}

export function validatePolicyDraft(active: CreditPolicy, draft: CreditPolicy, note: string, by: string, at: string): CreditPolicy {
  const n = (note ?? "").trim();
  if (n.length < 5) throw new ValidationError("A change note is required.");
  const sc = draft?.scorecard;
  if (!sc || !Array.isArray(draft.rules) || !draft.pricing || !draft.affordability) throw new ValidationError("Policy is incomplete.");
  if (sc.declineCutoff > sc.approveCutoff) throw new ValidationError("Decline cutoff must not exceed the approve cutoff.");
  if (!(sc.bandFloors.A >= sc.bandFloors.B && sc.bandFloors.B >= sc.bandFloors.C && sc.bandFloors.C >= sc.bandFloors.D)) throw new ValidationError("Band floors must descend from A to D.");
  if (draft.affordability.minDscr < 1) throw new ValidationError("Minimum DSCR must be at least 1.0.");
  if (draft.pricing.minLoan <= 0 || draft.pricing.maxLoan < draft.pricing.minLoan) throw new ValidationError("Loan limits are inconsistent.");
  if (policyKey(draft) === policyKey(active)) throw new ValidationError("The draft has no changes.");
  return { ...draft, version: nextVersion(active.version), publishedAt: at, publishedBy: by, note: n };
}

export function validateNewBusiness(i: NewBusinessInput): void {
  const bad = (m: string) => { throw new ValidationError(m); };
  if (!i.name?.trim() || i.name.length > 120) bad("Business name is required.");
  if (!INDUSTRIES.some((x) => x.name === i.industry)) bad("Unknown industry.");
  if (!(i.monthsInBusiness >= 0 && i.monthsInBusiness <= 1200)) bad("Months in business is out of range.");
  if (!(i.ownerCreditScore >= 300 && i.ownerCreditScore <= 850)) bad("Owner credit score must be 300–850.");
  if (!(i.requestedAmount > 0 && i.requestedAmount <= 5_000_000)) bad("Requested amount is out of range.");
  if (!(i.statedAnnualRevenue > 0 && i.statedAnnualRevenue <= 100_000_000)) bad("Stated revenue is out of range.");
  if (!["strong", "average", "weak"].includes(i.bankProfile)) bad("Unknown bank profile.");
  if (!["clean", "refer", "fail", "auto"].includes(i.kycScenario)) bad("Unknown verification scenario.");
}

// ---------------------------------------------------------------- seeded history

/** Synthetic analyst history so the seeded book contains resolved reviews and a few overrides. */
function seededHumanAction(d: Decision, policy: CreditPolicy): HumanAction | null {
  const rng = new Rng(d.businessId + ":analyst");
  const app = d.inputs.application;
  const at = new Date(Date.parse(app.appliedOn + "T15:00:00Z") + rng.int(1, 3) * 86400000).toISOString();
  if (at.slice(0, 10) > "2026-10-20") return null; // recent reviews stay in the queue
  const by = rng.pick(ANALYSTS);
  const codes = d.reasons.map((r) => r.code);
  const pick = (code: string) => HUMAN_DECLINE_REASONS.find((r) => r.code === code)!;
  if (d.engineOutcome === "REVIEW") {
    if (codes.some((c) => c.startsWith("KYC-")) && rng.chance(0.2)) return { by, at, kind: "review", action: "DECLINE", reasons: [pick("HUM-KYC")], note: "Verification could not be cleared with documents provided." };
    if (codes.includes("DOC-REV") && rng.chance(0.5)) return { by, at, kind: "review", action: "DECLINE", reasons: [pick("HUM-DOCS")], note: "Tax return revenue did not support the application." };
    if (codes.includes("SC-REVIEW") && d.score < policy.scorecard.declineCutoff + 20 && rng.chance(0.55)) {
      const a = d.inputs.attributes;
      return { by, at, kind: "review", action: "DECLINE", reasons: [a.debtServiceRatio > 10 ? pick("HUM-DEBT") : pick("HUM-CASH")], note: "Marginal file; weaknesses not offset by mitigants." };
    }
    const offer = d.offer!;
    const amount = codes.includes("EXP-LARGE") ? policy.pricing.manualReviewAbove : codes.includes("SC-REVIEW") && rng.chance(0.4) ? Math.floor((offer.amount * 0.8) / 1000) * 1000 : offer.amount;
    return { by, at, kind: "review", action: "APPROVE", reasons: [], note: amount < offer.amount ? `Approved at reduced amount $${amount.toLocaleString("en-US")}.` : "Mitigants confirmed; approved as offered.", offer: offerAtAmount(policy, d, amount) };
  }
  if (d.engineOutcome === "DECLINE" && d.reasons[0]?.code === "SC-CUTOFF" && d.score >= policy.scorecard.declineCutoff - 10 && rng.chance(0.25)) {
    const amount = Math.max(policy.pricing.minLoan, Math.floor((d.inputs.application.requestedAmount * 0.5) / 1000) * 1000);
    return { by: "r.okafor (senior analyst)", at, kind: "override", action: "APPROVE", reasons: [], note: "Override: 6-year deposit relationship and signed contract backlog offset score. Reduced amount; within delegated authority.", offer: offerAtAmount(policy, d, amount) };
  }
  if (d.engineOutcome === "APPROVE" && rng.chance(0.012)) {
    return { by: "r.okafor (senior analyst)", at, kind: "override", action: "DECLINE", reasons: [pick("HUM-DEBT")], note: "Override: public records show an unreported tax lien and judgment." };
  }
  return null;
}

/** The seeded book: 500 applications decided under POL-1.0 plus analyst history, with audit events in time order. */
export function seedWorld(): { world: Omit<World, "audit">; audit: AuditInput[] } {
  const businesses = generatePortfolio();
  const decisions: Record<string, Decision> = {};
  const events: AuditInput[] = [policyAudit(DEFAULT_POLICY)];
  for (const b of businesses) {
    const at = `${b.application.appliedOn}T${String(9 + (parseInt(b.id.slice(-3)) % 8)).padStart(2, "0")}:${String(parseInt(b.id.slice(-2)) % 60).padStart(2, "0")}:00.000Z`;
    events.push(...intakeAudit(b, at));
    const d = decide(b, DEFAULT_POLICY, at);
    events.push(decisionAudit(d));
    const h = seededHumanAction(d, DEFAULT_POLICY);
    if (h) {
      events.push(humanAudit(d, h));
      decisions[b.id] = { ...d, human: h };
    } else decisions[b.id] = d;
  }
  events.sort((a, b) => a.at.localeCompare(b.at)); // stable: intake → decision → human for equal times
  return { world: { businesses, policies: [DEFAULT_POLICY], decisions }, audit: events };
}

// ---------------------------------------------------------------- local mode (browser-only demo)

export function applyAction(w: World, a: UserAction) {
  switch (a.t) {
    case "publish":
      w.policies.push(a.policy);
      appendAudit(w.audit, policyAudit(a.policy));
      break;
    case "human": {
      const d = w.decisions[a.businessId];
      if (!d || d.human) break;
      appendAudit(w.audit, humanAudit(d, a.human));
      w.decisions[a.businessId] = { ...d, human: a.human };
      break;
    }
    case "onboard": {
      const b = buildBusiness(a.input);
      const d = decide(b, activePolicy(w), a.at);
      w.businesses.push(b);
      w.decisions[b.id] = d;
      for (const e of [...intakeAudit(b, a.at), decisionAudit(d)]) appendAudit(w.audit, e);
      break;
    }
    case "ai":
      appendAudit(w.audit, aiAudit(a.ref, a.output, a.at));
      break;
  }
}

export function buildLocalWorld(actions: UserAction[]): World {
  const { world, audit } = seedWorld();
  const w: World = { ...world, audit: [] };
  for (const e of audit) appendAudit(w.audit, e);
  for (const a of actions) applyAction(w, a);
  return w;
}
