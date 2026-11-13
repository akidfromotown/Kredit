// Modules 4–6: a versioned credit policy bundling knockout rules, the scorecard, cutoffs,
// limit / pricing grids and the affordability cap. Every decision references one version.
import { attrMeta, formatAttr } from "./attributes";
import type { AttributeKey, Attributes } from "./types";

export type Operator = "<" | "<=" | ">" | ">=" | "==";

export interface KnockoutRule {
  id: string;
  attribute: AttributeKey;
  operator: Operator;
  threshold: number;
  enabled: boolean;
  reasonCode: string;
  /** Plain description of the policy requirement, used in decline reasons. */
  requirement: string;
}

export interface ScoreBin {
  /** Inclusive lower bound; the first bin should be -Infinity. */
  min: number;
  label: string;
  points: number;
}

export interface Characteristic {
  attribute: AttributeKey;
  bins: ScoreBin[];
}

export type Band = "A" | "B" | "C" | "D" | "E";
export const BANDS: Band[] = ["A", "B", "C", "D", "E"];

export interface Scorecard {
  basePoints: number;
  characteristics: Characteristic[];
  /** Minimum score for each band (E has no minimum). */
  bandFloors: Record<Exclude<Band, "E">, number>;
  approveCutoff: number;
  declineCutoff: number;
}

export interface PricingGrid {
  /** Max exposure as % of annual verified revenue, by band. */
  limitPctOfRevenue: Record<Band, number>;
  /** APR % by band and term. */
  apr: Record<Band, Record<number, number>>;
  terms: number[];
  minLoan: number;
  maxLoan: number;
  /** Requests above this are routed to manual review even if the score auto-approves. */
  manualReviewAbove: number;
}

export interface Affordability {
  /** Minimum DSCR: net operating cash flow / (existing + new debt service). */
  minDscr: number;
  /** New payment may not exceed this % of avg monthly revenue. */
  maxPaymentPctRevenue: number;
}

export interface CreditPolicy {
  version: string;
  publishedAt: string;
  publishedBy: string;
  note: string;
  rules: KnockoutRule[];
  scorecard: Scorecard;
  pricing: PricingGrid;
  affordability: Affordability;
}

const NEG = -Infinity;

export const DEFAULT_POLICY: CreditPolicy = {
  version: "POL-1.0",
  publishedAt: "2025-10-15T09:00:00Z",
  publishedBy: "Credit Risk Committee",
  note: "Initial launch policy for in-house term loans.",
  rules: [
    { id: "KO-TIB", attribute: "monthsInBusiness", operator: "<", threshold: 12, enabled: true, reasonCode: "KO-TIB", requirement: "at least 12 months in business" },
    { id: "KO-REV", attribute: "avgMonthlyRevenue", operator: "<", threshold: 10000, enabled: true, reasonCode: "KO-REV", requirement: "average monthly revenue of at least $10,000" },
    { id: "KO-NSF", attribute: "nsfCount3m", operator: ">", threshold: 6, enabled: true, reasonCode: "KO-NSF", requirement: "no more than 6 NSF / overdraft events in the last 3 months" },
    { id: "KO-CASH", attribute: "daysCashOnHand", operator: "<", threshold: 3, enabled: true, reasonCode: "KO-CASH", requirement: "at least 3 days of cash on hand" },
    { id: "KO-TREND", attribute: "revenueTrendPct", operator: "<", threshold: -35, enabled: true, reasonCode: "KO-TREND", requirement: "revenue decline no worse than -35%" },
    { id: "KO-DSR", attribute: "debtServiceRatio", operator: ">", threshold: 25, enabled: true, reasonCode: "KO-DSR", requirement: "existing debt service at or below 25% of revenue" },
    { id: "KO-FICO", attribute: "ownerCreditScore", operator: "<", threshold: 580, enabled: true, reasonCode: "KO-FICO", requirement: "owner credit score of at least 580" },
    { id: "KO-CONC", attribute: "customerConcentration", operator: ">", threshold: 75, enabled: true, reasonCode: "KO-CONC", requirement: "no single customer above 75% of revenue" },
    { id: "KO-IND", attribute: "restrictedIndustry", operator: "==", threshold: 1, enabled: true, reasonCode: "KO-IND", requirement: "an industry outside the restricted list" },
    { id: "KO-MISREP", attribute: "statedRevenueVariancePct", operator: ">", threshold: 50, enabled: false, reasonCode: "KO-MISREP", requirement: "stated revenue within 50% of verified revenue" },
  ],
  scorecard: {
    basePoints: 200,
    characteristics: [
      { attribute: "monthsInBusiness", bins: [{ min: NEG, label: "< 24 mo", points: 10 }, { min: 24, label: "24–59 mo", points: 25 }, { min: 60, label: "60–119 mo", points: 40 }, { min: 120, label: "120+ mo", points: 50 }] },
      { attribute: "avgMonthlyRevenue", bins: [{ min: NEG, label: "< $25k", points: 10 }, { min: 25000, label: "$25k–75k", points: 25 }, { min: 75000, label: "$75k–200k", points: 40 }, { min: 200000, label: "$200k+", points: 50 }] },
      { attribute: "revenueTrendPct", bins: [{ min: NEG, label: "< -15%", points: 0 }, { min: -15, label: "-15% to 0%", points: 20 }, { min: 0, label: "0% to 15%", points: 35 }, { min: 15, label: "15%+", points: 45 }] },
      { attribute: "revenueVolatility", bins: [{ min: NEG, label: "< 0.10", points: 45 }, { min: 0.1, label: "0.10–0.20", points: 35 }, { min: 0.2, label: "0.20–0.35", points: 20 }, { min: 0.35, label: "0.35+", points: 5 }] },
      { attribute: "daysCashOnHand", bins: [{ min: NEG, label: "< 10 days", points: 5 }, { min: 10, label: "10–29 days", points: 25 }, { min: 30, label: "30–59 days", points: 40 }, { min: 60, label: "60+ days", points: 55 }] },
      { attribute: "nsfCount12m", bins: [{ min: NEG, label: "0", points: 50 }, { min: 1, label: "1–3", points: 30 }, { min: 4, label: "4–10", points: 10 }, { min: 11, label: "11+", points: 0 }] },
      { attribute: "debtServiceRatio", bins: [{ min: NEG, label: "None", points: 40 }, { min: 0.01, label: "0–8%", points: 30 }, { min: 8, label: "8–15%", points: 15 }, { min: 15, label: "15%+", points: 0 }] },
      { attribute: "customerConcentration", bins: [{ min: NEG, label: "< 15%", points: 45 }, { min: 15, label: "15–30%", points: 35 }, { min: 30, label: "30–50%", points: 20 }, { min: 50, label: "50%+", points: 5 }] },
      { attribute: "ownerCreditScore", bins: [{ min: NEG, label: "< 620", points: 5 }, { min: 620, label: "620–679", points: 20 }, { min: 680, label: "680–739", points: 35 }, { min: 740, label: "740+", points: 50 }] },
    ],
    bandFloors: { A: 540, B: 495, C: 450, D: 410 },
    approveCutoff: 495,
    declineCutoff: 450,
  },
  pricing: {
    limitPctOfRevenue: { A: 15, B: 12, C: 8, D: 5, E: 0 },
    apr: {
      A: { 6: 9.9, 12: 10.9, 18: 11.9, 24: 12.9 },
      B: { 6: 13.9, 12: 14.9, 18: 15.9, 24: 16.9 },
      C: { 6: 18.9, 12: 19.9, 18: 21.9, 24: 23.9 },
      D: { 6: 26.9, 12: 28.9, 18: 29.9, 24: 29.9 },
      E: { 6: 0, 12: 0, 18: 0, 24: 0 },
    },
    terms: [6, 12, 18, 24],
    minLoan: 5000,
    maxLoan: 500000,
    manualReviewAbove: 250000,
  },
  affordability: { minDscr: 1.25, maxPaymentPctRevenue: 12 },
};

export function evaluateOperator(v: number, op: Operator, t: number): boolean {
  switch (op) {
    case "<": return v < t;
    case "<=": return v <= t;
    case ">": return v > t;
    case ">=": return v >= t;
    case "==": return v === t;
  }
}

export interface RuleResult {
  rule: KnockoutRule;
  value: number;
  hit: boolean;
}

export function evaluateKnockouts(policy: CreditPolicy, a: Attributes): RuleResult[] {
  return policy.rules.filter((r) => r.enabled).map((rule) => {
    const value = a[rule.attribute];
    return { rule, value, hit: evaluateOperator(value, rule.operator, rule.threshold) };
  });
}

export function knockoutReason(r: RuleResult): string {
  if (r.rule.attribute === "restrictedIndustry") return "The business operates in an industry we do not currently lend to.";
  return `${attrMeta(r.rule.attribute).label} is ${formatAttr(r.rule.attribute, r.value)}; policy requires ${r.rule.requirement}.`;
}

export interface ScoreLine {
  attribute: AttributeKey;
  value: number;
  bin: string;
  points: number;
  maxPoints: number;
}

export interface ScoreResult {
  score: number;
  band: Band;
  lines: ScoreLine[];
}

export function scoreApplicant(sc: Scorecard, a: Attributes): ScoreResult {
  const lines = sc.characteristics.map((c) => {
    const v = a[c.attribute];
    let bin = c.bins[0];
    for (const b of c.bins) if (v >= b.min) bin = b;
    return { attribute: c.attribute, value: v, bin: bin.label, points: bin.points, maxPoints: Math.max(...c.bins.map((b) => b.points)) };
  });
  const score = sc.basePoints + lines.reduce((s, l) => s + l.points, 0);
  return { score, band: bandFor(sc, score), lines };
}

export function bandFor(sc: Scorecard, score: number): Band {
  if (score >= sc.bandFloors.A) return "A";
  if (score >= sc.bandFloors.B) return "B";
  if (score >= sc.bandFloors.C) return "C";
  if (score >= sc.bandFloors.D) return "D";
  return "E";
}

export function scoreRange(sc: Scorecard): [number, number] {
  const lo = sc.basePoints + sc.characteristics.reduce((s, c) => s + Math.min(...c.bins.map((b) => b.points)), 0);
  const hi = sc.basePoints + sc.characteristics.reduce((s, c) => s + Math.max(...c.bins.map((b) => b.points)), 0);
  return [lo, hi];
}

/**
 * Adverse-action style reasons: characteristics ranked by points lost versus the maximum available,
 * as used for score-based declines.
 */
export function adverseReasons(s: ScoreResult, n = 4): ScoreLine[] {
  return [...s.lines].filter((l) => l.maxPoints - l.points > 0).sort((x, y) => y.maxPoints - y.points - (x.maxPoints - x.points)).slice(0, n);
}

export function scoreReasonText(l: ScoreLine): string {
  const label = attrMeta(l.attribute).label;
  return `${label} (${formatAttr(l.attribute, l.value)}) scored ${l.points} of ${l.maxPoints} available points.`;
}

export function clonePolicy(p: CreditPolicy): CreditPolicy {
  return JSON.parse(JSON.stringify(p, (_k, v) => (v === -Infinity ? "__NEG_INF__" : v)), (_k, v) => (v === "__NEG_INF__" ? -Infinity : v));
}

export function nextVersion(v: string): string {
  const [maj, min] = v.replace("POL-", "").split(".").map(Number);
  return `POL-${maj}.${min + 1}`;
}
