// App state. The seeded world (500 applications decided under POL-1.0, analyst review history) is rebuilt
// deterministically on every load; the user's own actions are kept as an append-only list in localStorage
// and replayed on top, so policy edits, reviews, overrides, onboarded applicants and the audit trail persist.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { appendAudit, type AuditEntry } from "./engine/audit";
import type { AiOutput } from "./engine/assistant";
import { AS_OF } from "./engine/dates";
import { buildBusiness, generatePortfolio, type NewBusinessInput } from "./engine/data";
import { HUMAN_DECLINE_REASONS, decide, finalStatus, offerAtAmount, type Decision, type HumanAction } from "./engine/decision";
import { kycOutcome } from "./engine/kyc";
import { DEFAULT_POLICY, clonePolicy, type CreditPolicy } from "./engine/policy";
import { accountTriggers, bookLoans, type Loan, type Trigger } from "./engine/portfolio";
import { Rng } from "./engine/rng";
import type { Business } from "./engine/types";

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

const STORAGE_KEY = "kredit.actions.v1";
export const CURRENT_USER = "you (demo credit officer)";
const ANALYSTS = ["j.alvarez (analyst)", "m.chen (analyst)", "r.okafor (senior analyst)"];

function loadActions(): UserAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw, (_k, v) => (v === "__NEG_INF__" ? -Infinity : v)) as UserAction[]) : [];
  } catch {
    return [];
  }
}
function saveActions(a: UserAction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a, (_k, v) => (v === -Infinity ? "__NEG_INF__" : v)));
  } catch {
    /* storage unavailable: session-only */
  }
}

export const activePolicy = (w: World) => w.policies[w.policies.length - 1];

function recordDecision(w: World, b: Business, d: Decision) {
  w.decisions[b.id] = d;
  appendAudit(w.audit, {
    at: d.decidedAt, actor: "decision engine", actorType: "system", type: "DECISION", ref: d.id,
    summary: `${b.name}: ${d.engineOutcome} · score ${d.score} (${d.band}) · ${d.policyVersion}`,
    payload: { businessId: b.id, applicationId: d.applicationId, policyVersion: d.policyVersion, inputs: d.inputs, knockouts: d.knockouts, score: d.score, band: d.band, offer: d.offer, outcome: d.engineOutcome, reasons: d.reasons },
  });
}

function intake(w: World, b: Business, at: string) {
  appendAudit(w.audit, {
    at, actor: b.source === "onboarded" ? CURRENT_USER : "applicant portal", actorType: b.source === "onboarded" ? "human" : "system",
    type: "APPLICATION_SUBMITTED", ref: b.application.id,
    summary: `${b.name} applied for $${b.application.requestedAmount.toLocaleString("en-US")} / ${b.application.requestedTermMonths} mo`,
    payload: { businessId: b.id, application: b.application },
  });
  appendAudit(w.audit, {
    at, actor: "kyc orchestrator (mock)", actorType: "system", type: "KYC_COMPLETED", ref: b.application.id,
    summary: `${b.name}: KYC/KYB ${kycOutcome(b.kyc)}`,
    payload: { businessId: b.id, checks: b.kyc },
  });
}

function applyHuman(w: World, businessId: string, human: HumanAction) {
  const d = w.decisions[businessId];
  if (!d) return;
  const before = finalStatus(d);
  w.decisions[businessId] = { ...d, human };
  appendAudit(w.audit, {
    at: human.at, actor: human.by, actorType: "human", type: human.kind === "override" ? "OVERRIDE" : "REVIEW_RESOLVED", ref: d.id,
    summary: `${d.businessName}: ${before} → ${human.action === "APPROVE" ? "APPROVED" : "DECLINED"} (${human.kind})`,
    payload: { decisionId: d.id, engineOutcome: d.engineOutcome, statusBefore: before, human },
  });
}

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
  // a handful of documented overrides of automated outcomes
  if (d.engineOutcome === "DECLINE" && d.reasons[0]?.code === "SC-CUTOFF" && d.score >= policy.scorecard.declineCutoff - 10 && rng.chance(0.25)) {
    const amount = Math.max(policy.pricing.minLoan, Math.floor((d.inputs.application.requestedAmount * 0.5) / 1000) * 1000);
    return { by: "r.okafor (senior analyst)", at, kind: "override", action: "APPROVE", reasons: [], note: "Override: 6-year deposit relationship and signed contract backlog offset score. Reduced amount; within delegated authority.", offer: offerAtAmount(policy, d, amount) };
  }
  if (d.engineOutcome === "APPROVE" && rng.chance(0.012)) {
    return { by: "r.okafor (senior analyst)", at, kind: "override", action: "DECLINE", reasons: [pick("HUM-DEBT")], note: "Override: public records show an unreported tax lien and judgment." };
  }
  return null;
}

export function buildWorld(actions: UserAction[]): World {
  const businesses = generatePortfolio();
  const w: World = { businesses, policies: [DEFAULT_POLICY], decisions: {}, audit: [] };
  appendAudit(w.audit, { at: DEFAULT_POLICY.publishedAt, actor: DEFAULT_POLICY.publishedBy, actorType: "human", type: "POLICY_PUBLISHED", ref: DEFAULT_POLICY.version, summary: `${DEFAULT_POLICY.version} published: ${DEFAULT_POLICY.note}`, payload: DEFAULT_POLICY });

  type Ev = { at: string; run: () => void };
  const evs: Ev[] = [];
  for (const b of businesses) {
    const at = `${b.application.appliedOn}T${String(9 + (parseInt(b.id.slice(-3)) % 8)).padStart(2, "0")}:${String(parseInt(b.id.slice(-2)) % 60).padStart(2, "0")}:00.000Z`;
    evs.push({ at, run: () => { intake(w, b, at); const d = decide(b, DEFAULT_POLICY, at); recordDecision(w, b, d); } });
    evs.push({ at: at.slice(0, 10) + "T23:00:00.000Z", run: () => { const d = w.decisions[b.id]; const h = d && seededHumanAction(d, DEFAULT_POLICY); if (h) applyHuman(w, b.id, h); } });
  }
  // stable sort by time; the human-action placeholder runs after the decision it depends on
  evs.sort((a, b) => a.at.localeCompare(b.at));
  const pending: Ev[] = [];
  for (const e of evs) {
    if (e.at.endsWith("T23:00:00.000Z")) pending.push(e); else e.run();
  }
  // resolution timestamps are 1–3 days after the decision, so apply them after all decisions in time order
  pending.forEach((e) => e.run());
  w.audit.sort((a, b) => a.at.localeCompare(b.at));
  // rebuild the chain in chronological order
  const entries = w.audit.splice(0);
  for (const e of entries) appendAudit(w.audit, { at: e.at, actor: e.actor, actorType: e.actorType, type: e.type, ref: e.ref, summary: e.summary, payload: e.payload });

  for (const a of actions) applyAction(w, a);
  return w;
}

function applyAction(w: World, a: UserAction) {
  switch (a.t) {
    case "publish":
      w.policies.push(a.policy);
      appendAudit(w.audit, { at: a.at, actor: a.by, actorType: "human", type: "POLICY_PUBLISHED", ref: a.policy.version, summary: `${a.policy.version} published: ${a.policy.note}`, payload: a.policy });
      break;
    case "human":
      applyHuman(w, a.businessId, a.human);
      break;
    case "onboard": {
      const b = buildBusiness(a.input);
      w.businesses.push(b);
      intake(w, b, a.at);
      recordDecision(w, b, decide(b, activePolicy(w), a.at));
      break;
    }
    case "ai":
      appendAudit(w.audit, { at: a.at, actor: "kredit assistant (demo)", actorType: "ai", type: "AI_OUTPUT", ref: a.ref, summary: `${a.output.title} (advisory only)`, payload: a.output });
      break;
  }
}

interface Store {
  world: World;
  version: number;
  loans: Loan[];
  triggers: Trigger[];
  policy: CreditPolicy;
  publishPolicy: (p: CreditPolicy) => void;
  recordHuman: (businessId: string, h: Omit<HumanAction, "by" | "at">) => void;
  onboard: (input: NewBusinessInput) => Decision;
  logAi: (ref: string, out: AiOutput) => void;
  reset: () => void;
  userActionCount: number;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ world: World; actions: UserAction[]; version: number } | null>(null);

  useEffect(() => {
    // build after first paint so the splash shows
    const id = setTimeout(() => {
      const actions = loadActions();
      setState({ world: buildWorld(actions), actions, version: 0 });
    }, 30);
    return () => clearTimeout(id);
  }, []);

  const derived = useMemo(() => {
    if (!state) return null;
    const loans = bookLoans(state.world.businesses, state.world.decisions);
    const byId = new Map(state.world.businesses.map((b) => [b.id, b]));
    const triggers = loans.flatMap((l) => accountTriggers(l, byId.get(l.businessId)!));
    return { loans, triggers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.version]);

  if (!state || !derived) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center space-y-2">
          <div className="text-xl font-semibold">Kredit</div>
          <div className="text-sm text-muted-foreground">Generating 500 synthetic businesses and deciding their applications…</div>
        </div>
      </div>
    );
  }

  const push = (a: UserAction) => {
    applyAction(state.world, a);
    const actions = [...state.actions, a];
    saveActions(actions);
    setState({ world: state.world, actions, version: state.version + 1 });
  };

  const store: Store = {
    world: state.world,
    version: state.version,
    loans: derived.loans,
    triggers: derived.triggers,
    policy: activePolicy(state.world),
    userActionCount: state.actions.length,
    publishPolicy: (p) => push({ t: "publish", at: new Date().toISOString(), by: CURRENT_USER, policy: clonePolicy(p) }),
    recordHuman: (businessId, h) => {
      const at = new Date().toISOString();
      push({ t: "human", at, businessId, human: { ...h, by: CURRENT_USER, at } });
    },
    onboard: (input) => {
      push({ t: "onboard", at: new Date().toISOString(), input });
      return state.world.decisions[input.id];
    },
    logAi: (ref, out) => push({ t: "ai", at: new Date().toISOString(), ref, output: { task: out.task, title: out.title, body: out.body } }),
    reset: () => {
      saveActions([]);
      setState({ world: buildWorld([]), actions: [], version: state.version + 1 });
    },
  };
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("StoreProvider missing");
  return s;
}

export { AS_OF };
