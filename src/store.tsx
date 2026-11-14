// App state with two modes.
// - Backend: the world is loaded from Supabase; actions call the kredit-api Edge Function, which decides,
//   validates and writes, and the response is merged into local state.
// - Local (no Supabase keys): the seeded world is rebuilt in the browser and the user's actions are kept in
//   localStorage and replayed. Same validation rules, same audit events.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { verifyChain } from "./engine/audit";
import type { AiOutput, AiTask } from "./engine/assistant";
import { AS_OF } from "./engine/dates";
import type { Decision } from "./engine/decision";
import { clonePolicy, type CreditPolicy } from "./engine/policy";
import { accountTriggers, bookLoans, type Loan, type Trigger } from "./engine/portfolio";
import {
  CURRENT_USER, activePolicy, applyAction, buildLocalWorld, validateHuman, validateNewBusiness, validatePolicyDraft,
  type UserAction, type World,
} from "./engine/world";
import type { NewBusinessInput } from "./engine/data";
import { alertStatuses, buildAlerts, type AlertStatus, type DispositionAction, type FinCrimeAlert } from "./engine/fincrime";
import { validateDisposition } from "./engine/world";
import type { ApiResponse, OnboardInput } from "./server/api";
import { backendEnabled, callApi, loadRemoteWorld, verifyRemoteAudit } from "./data/remote";

export type { World, UserAction };
export { CURRENT_USER };

export interface HumanInput {
  action: "APPROVE" | "DECLINE";
  note: string;
  reasonCodes?: string[];
  amount?: number;
}

const STORAGE_KEY = "kredit.actions.v2";

function loadActions(): UserAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserAction[]) : [];
  } catch {
    return [];
  }
}
function saveActions(a: UserAction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
  } catch {
    /* storage unavailable: session-only */
  }
}

interface Store {
  mode: "backend" | "local";
  world: World;
  version: number;
  loans: Loan[];
  triggers: Trigger[];
  policy: CreditPolicy;
  publishPolicy: (draft: CreditPolicy, note: string) => Promise<CreditPolicy>;
  recordHuman: (businessId: string, input: HumanInput) => Promise<void>;
  onboard: (input: OnboardInput) => Promise<Decision>;
  logAi: (task: AiTask, businessId: string | undefined, out: AiOutput) => void;
  verifyAudit: () => Promise<{ ok: boolean; entries: number; brokenAt?: number }>;
  alerts: (FinCrimeAlert & { status: AlertStatus })[];
  recordDisposition: (alertId: string, action: DispositionAction, note: string) => Promise<void>;
  reset: () => void;
  userActionCount: number;
}

const Ctx = createContext<Store | null>(null);

type State = { world: World; actions: UserAction[]; version: number };

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State | null>(() => (backendEnabled ? null : { world: buildLocalWorld(loadActions()), actions: loadActions(), version: 0 }));
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!backendEnabled) return;
    loadRemoteWorld().then((world) => setState({ world, actions: [], version: 0 }), (e: Error) => setLoadError(e.message));
  }, []);

  const derived = useMemo(() => {
    if (!state) return null;
    const loans = bookLoans(state.world.businesses, state.world.decisions);
    const byId = new Map(state.world.businesses.map((b) => [b.id, b]));
    const triggers = loans.flatMap((l) => accountTriggers(l, byId.get(l.businessId)!));
    const statuses = alertStatuses(state.world.audit);
    const alerts = buildAlerts(state.world.businesses).map((a) => ({ ...a, status: statuses.get(a.id)?.status ?? ("open" as AlertStatus) }));
    return { loans, triggers, alerts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.version]);

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md text-center space-y-2">
          <div className="text-xl font-semibold">Kredit can't reach its database</div>
          <div className="text-sm text-muted-foreground">{loadError}</div>
        </div>
      </div>
    );
  }
  if (!state || !derived) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center space-y-2">
          <div className="text-xl font-semibold">Kredit</div>
          <div className="text-sm text-muted-foreground">Loading the portfolio…</div>
        </div>
      </div>
    );
  }

  const bump = (actions = state.actions) => setState({ world: state.world, actions, version: state.version + 1 });

  /** Local mode: apply and persist an action. */
  const push = (a: UserAction) => {
    applyAction(state.world, a);
    const actions = [...state.actions, a];
    saveActions(actions);
    bump(actions);
  };

  /** Backend mode: merge what the server wrote. */
  const merge = (r: ApiResponse) => {
    const w = state.world;
    if (r.business && !w.businesses.some((b) => b.id === r.business!.id)) w.businesses.push(r.business);
    if (r.decision) w.decisions[r.decision.businessId] = r.decision;
    if (r.policy) w.policies.push(r.policy);
    const seen = new Set(w.audit.map((e) => e.seq));
    w.audit.push(...r.audit.filter((e) => !seen.has(e.seq)));
    bump();
  };

  const now = () => new Date().toISOString();

  const store: Store = {
    mode: backendEnabled ? "backend" : "local",
    world: state.world,
    version: state.version,
    loans: derived.loans,
    triggers: derived.triggers,
    alerts: derived.alerts,

    async recordDisposition(alertId, action, note) {
      if (backendEnabled) return merge(await callApi({ op: "fincrime", alertId, action, note }));
      const alert = derived.alerts.find((a) => a.id === alertId);
      const at = now();
      const d = validateDisposition(alert, alert?.status ?? "open", { action, note }, CURRENT_USER, at);
      push({ t: "fincrime", at, disposition: d, alert: { id: alert!.id, businessId: alert!.businessId, businessName: alert!.businessName, title: alert!.title } });
    },
    policy: activePolicy(state.world),
    userActionCount: state.actions.length,

    async publishPolicy(draft, note) {
      if (backendEnabled) {
        const r = await callApi({ op: "publish", policy: draft, note });
        merge(r);
        return r.policy!;
      }
      const p = validatePolicyDraft(activePolicy(state.world), clonePolicy(draft), note, CURRENT_USER, now());
      push({ t: "publish", at: p.publishedAt, by: CURRENT_USER, policy: p });
      return p;
    },

    async recordHuman(businessId, input) {
      if (backendEnabled) return merge(await callApi({ op: "human", businessId, ...input }));
      const d = state.world.decisions[businessId];
      const policy = state.world.policies.find((p) => p.version === d.policyVersion)!;
      const at = now();
      push({ t: "human", at, businessId, human: validateHuman(d, policy, input, CURRENT_USER, at) });
    },

    async onboard(input) {
      if (backendEnabled) {
        const r = await callApi({ op: "onboard", input });
        merge(r);
        return r.decision!;
      }
      const at = now();
      const full: NewBusinessInput = { ...input, id: `BIZ-N${Date.now().toString(36).toUpperCase()}`, appliedOn: at.slice(0, 10) };
      validateNewBusiness(full);
      push({ t: "onboard", at, input: full });
      return state.world.decisions[full.id];
    },

    logAi(task, businessId, out) {
      if (backendEnabled) {
        callApi({ op: "ai", task, businessId }).then(merge, (e) => console.warn("AI log failed:", e));
        return;
      }
      const ref = businessId ? state.world.decisions[businessId]?.id ?? businessId : "monitoring";
      push({ t: "ai", at: now(), ref, output: { task: out.task, title: out.title, body: out.body } });
    },

    async verifyAudit() {
      if (backendEnabled) return verifyRemoteAudit();
      const r = verifyChain(state.world.audit);
      return { ok: r.ok, entries: state.world.audit.length, brokenAt: r.brokenAt };
    },

    reset() {
      if (backendEnabled) return;
      saveActions([]);
      setState({ world: buildLocalWorld([]), actions: [], version: state.version + 1 });
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
