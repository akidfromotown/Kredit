// Financial crime: list screening (sanctions, PEP, adverse media) through pluggable providers, transaction
// monitoring rules on bank data, and an alert lifecycle driven by analyst dispositions in the audit log.
// Alerts never change a credit decision; they route work to people.
import type { AuditEntry } from "./audit";
import { AS_OF_MONTH, addMonths, isoDate, daysInMonth, monthDiff } from "./dates";
import { Rng } from "./rng";
import type { Business } from "./types";

// ---------------------------------------------------------------- screening providers

export type ScreeningList = "sanctions" | "pep" | "adverse_media";

export const LIST_LABEL: Record<ScreeningList, string> = { sanctions: "Sanctions", pep: "PEP", adverse_media: "Adverse media" };

export interface ScreeningSubject {
  businessId: string;
  kind: "business" | "person";
  name: string;
  country: string;
}

export interface ScreeningHit {
  id: string;
  providerId: string;
  list: ScreeningList;
  subject: ScreeningSubject;
  /** 0–100 name/entity match confidence reported by the provider. */
  matchScore: number;
  matchedName: string;
  category: string;
  headline: string;
  source: string;
  publishedOn: string;
}

/**
 * A screening connector. Real vendors (adverse media, sanctions, PEP data) implement this interface,
 * run server-side with their own credentials, and return hits in this shape.
 */
export interface ScreeningProvider {
  id: string;
  name: string;
  covers: ScreeningList[];
  mode: "demo" | "live";
  screen(subjects: ScreeningSubject[]): Promise<ScreeningHit[]>;
}

const OUTLETS = ["Metro Business Journal", "Valley Courier", "State Capitol Report", "Harborview Times", "County Ledger"];
const MEDIA: { category: string; serious: boolean; text: (n: string) => string }[] = [
  { category: "Fraud", serious: true, text: (n) => `${n} named in state investigation into invoice fraud` },
  { category: "Money laundering", serious: true, text: (n) => `Prosecutors cite ${n} in cash-structuring case` },
  { category: "Tax", serious: true, text: (n) => `${n} charged over unpaid payroll taxes` },
  { category: "Litigation", serious: false, text: (n) => `${n} sued by former supplier over unpaid invoices` },
  { category: "Regulatory", serious: false, text: (n) => `Licensing board fines ${n} for permit violations` },
  { category: "Labour", serious: false, text: (n) => `Former employees allege wage violations at ${n}` },
];

/** Deterministic demo provider: fictional hits and fictional outlets, seeded by subject. */
export function demoScreen(subjects: ScreeningSubject[]): ScreeningHit[] {
  const hits: ScreeningHit[] = [];
  for (const s of subjects) {
    const rng = new Rng(`screen:${s.businessId}:${s.kind}`);
    const date = (monthsBack: number) => {
      const m = addMonths(AS_OF_MONTH, -monthsBack);
      return isoDate(m, rng.int(1, daysInMonth(m)));
    };
    const add = (list: ScreeningList, matchScore: number, matchedName: string, category: string, headline: string, source: string, monthsBack: number) =>
      hits.push({ id: `SCR-${s.businessId}-${s.kind[0]}-${list}`, providerId: "demo", list, subject: s, matchScore, matchedName, category, headline, source, publishedOn: date(monthsBack) });
    if (rng.chance(s.kind === "business" ? 0.05 : 0.03)) {
      const m = rng.pick(MEDIA);
      const strong = rng.chance(m.serious ? 0.45 : 0.7);
      const name = strong ? s.name : `${s.name.split(" ")[0]} ${rng.pick(["Holdings", "Group", "Partners"])}`;
      add("adverse_media", strong ? rng.int(86, 98) : rng.int(58, 74), name, m.category, m.text(name), rng.pick(OUTLETS), rng.int(0, 5));
    }
    if (s.kind === "person" && rng.chance(0.015)) {
      add("pep", rng.int(62, 90), s.name, "Domestic PEP", `Name matches a county commissioner in ${rng.pick(["TX", "FL", "OH", "GA"])}`, "Public officials register (demo)", rng.int(0, 2));
    }
    if (rng.chance(0.003)) {
      const near = `${s.name.split(" ")[0]} ${rng.pick(["Trading", "International", "Export"])} ${rng.pick(["LLC", "FZE", "Ltd"])}`;
      add("sanctions", rng.int(70, 84), near, "Near match", `Partial name match to a listed entity: ${near}`, "Consolidated sanctions list (demo)", 0);
    }
  }
  return hits;
}

export const demoProvider: ScreeningProvider = {
  id: "demo",
  name: "Demo screening",
  covers: ["sanctions", "pep", "adverse_media"],
  mode: "demo",
  screen: async (subjects) => demoScreen(subjects),
};

/** Connectors shown in the app. Only the demo provider is live today. */
export const CONNECTORS: { id: string; name: string; covers: ScreeningList[]; status: "connected" | "not_connected" }[] = [
  { id: "demo", name: "Demo screening", covers: ["sanctions", "pep", "adverse_media"], status: "connected" },
  { id: "adverse-media", name: "Adverse media provider", covers: ["adverse_media"], status: "not_connected" },
  { id: "sanctions-pep", name: "Sanctions & PEP data provider", covers: ["sanctions", "pep"], status: "not_connected" },
];

export const subjectsFor = (b: Business): ScreeningSubject[] => [
  { businessId: b.id, kind: "business", name: b.name, country: "US" },
  { businessId: b.id, kind: "person", name: b.owner.name, country: "US" },
];

// ---------------------------------------------------------------- transaction monitoring

export interface TmRule {
  id: string;
  name: string;
  /** Returns a description when the rule fires for the month at index i. */
  test: (b: Business, i: number) => string | null;
}

const usd = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;

export const TM_RULES: TmRule[] = [
  {
    id: "TM-SPIKE",
    name: "Deposit spike",
    test: (b, i) => {
      const m = b.months[i];
      const prior = b.months.slice(Math.max(0, i - 6), i);
      if (prior.length < 4) return null;
      const avg = prior.reduce((s, x) => s + x.revenue, 0) / prior.length;
      return m.revenue > 1.7 * avg && m.revenue - avg > 15000 ? `Deposits of ${usd(m.revenue)} are ${(m.revenue / avg).toFixed(1)}× the prior ${prior.length}-month average.` : null;
    },
  },
  {
    id: "TM-INJECT",
    name: "Large owner injection",
    test: (b, i) => {
      const m = b.months[i];
      return m.ownerContributions > 10000 && m.ownerContributions > 0.4 * m.revenue ? `Owner put in ${usd(m.ownerContributions)}, ${Math.round((m.ownerContributions / Math.max(m.revenue, 1)) * 100)}% of the month's sales.` : null;
    },
  },
  {
    id: "TM-PASSTHRU",
    name: "Funds passing through",
    test: (b, i) => {
      if (i < 2) return null;
      const w = b.months.slice(i - 2, i + 1);
      return w.every((m) => m.revenue > 30000 && m.avgBalance < 0.03 * m.revenue) ? `Average balance under 3% of deposits for three months running (${usd(w[2].revenue)} in, ${usd(w[2].avgBalance)} average balance).` : null;
    },
  },
];

// ---------------------------------------------------------------- alerts and dispositions

export type AlertStatus = "open" | "escalated" | "cleared" | "referred";
export type DispositionAction = "clear" | "escalate" | "refer";

export const ACTION_LABEL: Record<DispositionAction, string> = { clear: "Clear (false positive)", escalate: "Escalate", refer: "Refer for SAR (demo)" };

export interface FinCrimeAlert {
  id: string;
  businessId: string;
  businessName: string;
  source: "screening" | "monitoring";
  type: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  raisedOn: string;
  hit?: ScreeningHit;
}

/** How far back monitoring looks for new alerts. */
export const MONITORING_WINDOW_MONTHS = 3;

export function buildAlerts(businesses: Business[]): FinCrimeAlert[] {
  const out: FinCrimeAlert[] = [];
  const byId = new Map(businesses.map((b) => [b.id, b]));
  for (const h of demoScreen(businesses.flatMap(subjectsFor))) {
    const b = byId.get(h.subject.businessId)!;
    const serious = h.list === "sanctions" || ["Fraud", "Money laundering", "Tax"].includes(h.category);
    out.push({
      id: `FC-${h.id.slice(4)}`, businessId: b.id, businessName: b.name, source: "screening", type: LIST_LABEL[h.list],
      severity: serious && h.matchScore >= 80 ? "high" : h.matchScore >= 75 || serious ? "medium" : "low",
      title: `${LIST_LABEL[h.list]} · ${h.category}`, detail: `${h.headline} · ${h.source} · ${h.matchScore}% match`, raisedOn: h.publishedOn, hit: h,
    });
  }
  for (const b of businesses) {
    b.months.forEach((m, i) => {
      if (monthDiff(m.month, AS_OF_MONTH) >= MONITORING_WINDOW_MONTHS) return;
      for (const r of TM_RULES) {
        const d = r.test(b, i);
        if (d) out.push({ id: `FC-${b.id}-${r.id}-${m.month}`, businessId: b.id, businessName: b.name, source: "monitoring", type: r.name, severity: r.id === "TM-PASSTHRU" ? "high" : "medium", title: r.name, detail: d, raisedOn: isoDate(m.month, daysInMonth(m.month)) });
      }
    });
  }
  return out.sort((a, b) => b.raisedOn.localeCompare(a.raisedOn));
}

export interface Disposition {
  alertId: string;
  action: DispositionAction;
  note: string;
  by: string;
  at: string;
}

/** Current status of every alert, replayed from FINCRIME_DISPOSITION audit entries. */
export function alertStatuses(audit: AuditEntry[]): Map<string, { status: AlertStatus; history: Disposition[] }> {
  const map = new Map<string, { status: AlertStatus; history: Disposition[] }>();
  for (const e of audit) {
    if (e.type !== "FINCRIME_DISPOSITION") continue;
    const d = e.payload as Disposition;
    const cur = map.get(d.alertId) ?? { status: "open" as AlertStatus, history: [] };
    cur.history.push(d);
    cur.status = d.action === "clear" ? "cleared" : d.action === "refer" ? "referred" : "escalated";
    map.set(d.alertId, cur);
  }
  return map;
}

export const isClosed = (s: AlertStatus) => s === "cleared" || s === "referred";
