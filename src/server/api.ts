// kredit-api: the only write path in backend mode. Runs inside the Supabase Edge Function (bundled for Deno)
// and in tests against local Postgres. The browser sends intents; the server computes every decision,
// offer and audit record itself and rejects anything that breaks policy.
import type { AuditEntry, AuditInput } from "../engine/audit";
import {
  AI_TASK_LABEL, draftCreditMemo, explainDecline, screenDocuments, summarizeWarnings, type AiOutput, type AiTask,
} from "../engine/assistant";
import { buildBusiness, type NewBusinessInput } from "../engine/data";
import { decide, finalStatus, type Decision } from "../engine/decision";
import type { CreditPolicy } from "../engine/policy";
import { accountTriggers, bookLoans } from "../engine/portfolio";
import type { Business } from "../engine/types";
import {
  CURRENT_USER, ValidationError, aiAudit, decisionAudit, humanAudit, intakeAudit, policyAudit,
  validateHuman, validateNewBusiness, validatePolicyDraft,
} from "../engine/world";

export interface KreditDb {
  policies(): Promise<CreditPolicy[]>;
  business(id: string): Promise<Business | null>;
  decisionForBusiness(businessId: string): Promise<Decision | null>;
  allBusinesses(): Promise<Business[]>;
  allDecisions(): Promise<Decision[]>;
  recordApplication(b: Business, d: Decision, audit: AuditInput[]): Promise<AuditEntry[]>;
  recordHuman(decisionId: string, human: NonNullable<Decision["human"]>, audit: AuditInput[]): Promise<AuditEntry[]>;
  publishPolicy(p: CreditPolicy, audit: AuditInput[]): Promise<AuditEntry[]>;
  appendAudit(audit: AuditInput[]): Promise<AuditEntry[]>;
}

export type OnboardInput = Omit<NewBusinessInput, "id" | "appliedOn">;

export type ApiRequest =
  | { op: "onboard"; input: OnboardInput }
  | { op: "human"; businessId: string; action: "APPROVE" | "DECLINE"; note: string; reasonCodes?: string[]; amount?: number }
  | { op: "publish"; policy: CreditPolicy; note: string }
  | { op: "ai"; task: AiTask; businessId?: string };

export interface ApiResponse {
  audit: AuditEntry[];
  business?: Business;
  decision?: Decision;
  policy?: CreditPolicy;
  ai?: AiOutput;
}

export { ValidationError };

const latest = (ps: CreditPolicy[]) => {
  if (!ps.length) throw new Error("No credit policy is published. Run the seed script.");
  return ps[ps.length - 1];
};

export async function handle(db: KreditDb, req: ApiRequest, now = new Date(), actor = CURRENT_USER): Promise<ApiResponse> {
  const at = now.toISOString();
  switch (req?.op) {
    case "onboard": {
      const input = { ...req.input, id: `BIZ-N${now.getTime().toString(36).toUpperCase()}`, appliedOn: at.slice(0, 10) } as NewBusinessInput;
      validateNewBusiness(input);
      const policy = latest(await db.policies());
      const b = buildBusiness(input);
      const d = decide(b, policy, at);
      const audit = await db.recordApplication(b, d, [...intakeAudit(b, at), decisionAudit(d)]);
      return { business: b, decision: d, audit };
    }
    case "human": {
      const d = await db.decisionForBusiness(req.businessId);
      if (!d) throw new ValidationError("Application not found.");
      const policy = (await db.policies()).find((p) => p.version === d.policyVersion);
      if (!policy) throw new Error(`Policy ${d.policyVersion} missing.`);
      const human = validateHuman(d, policy, req, actor, at);
      const audit = await db.recordHuman(d.id, human, [humanAudit(d, human)]);
      return { decision: { ...d, human }, audit };
    }
    case "publish": {
      const active = latest(await db.policies());
      const p = validatePolicyDraft(active, req.policy, req.note, actor, at);
      const audit = await db.publishPolicy(p, [policyAudit(p)]);
      return { policy: p, audit };
    }
    case "ai": {
      if (!(req.task in AI_TASK_LABEL)) throw new ValidationError("Unknown assistant task.");
      let out: AiOutput;
      let ref: string;
      if (req.task === "summarize_warnings") {
        const [bs, ds] = await Promise.all([db.allBusinesses(), db.allDecisions()]);
        const byId = new Map(bs.map((b) => [b.id, b]));
        const loans = bookLoans(bs, Object.fromEntries(ds.map((d) => [d.businessId, d])));
        out = summarizeWarnings(loans, loans.flatMap((l) => accountTriggers(l, byId.get(l.businessId)!)));
        ref = "monitoring";
      } else {
        const [b, d] = await Promise.all([db.business(req.businessId ?? ""), db.decisionForBusiness(req.businessId ?? "")]);
        if (!b || !d) throw new ValidationError("Application not found.");
        if (req.task === "explain_decline" && finalStatus(d) !== "DECLINED") throw new ValidationError("Only declined applications get a decline explanation.");
        out = req.task === "screen_documents" ? screenDocuments(b, d) : req.task === "credit_memo" ? draftCreditMemo(b, d) : explainDecline(b, d);
        ref = d.id;
      }
      const audit = await db.appendAudit([aiAudit(ref, out, at)]);
      return { ai: out, audit };
    }
    default:
      throw new ValidationError("Unknown operation.");
  }
}
