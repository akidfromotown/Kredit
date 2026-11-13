// Modules 8–10: booked loans, monitoring triggers, vintage curves, roll rates, collections stages,
// loss forecast and model validation. Loan performance is simulated ("the world"); nothing here decides credit.
import { AS_OF_MONTH, addMonths, monthDiff, monthRange } from "./dates";
import { bookedTerms, type Decision } from "./decision";
import {
  BUCKETS, amortPayment, is30Plus, simulateLoanPath, type Bucket, type LoanMonth,
} from "./loanSim";
import type { Band } from "./policy";
import type { Business } from "./types";

export interface Loan {
  id: string;
  businessId: string;
  businessName: string;
  decisionId: string;
  band: Band;
  score: number;
  amount: number;
  aprPct: number;
  termMonths: number;
  payment: number;
  originationMonth: string;
  path: LoanMonth[];
  /** State as of AS_OF_MONTH (or at origination if no months elapsed). */
  bucket: Bucket;
  balance: number;
  chargedOff: number;
  ever30: boolean;
}

export function bookLoans(businesses: Business[], decisions: Record<string, Decision>): Loan[] {
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const loans: Loan[] = [];
  for (const d of Object.values(decisions)) {
    const terms = bookedTerms(d);
    const b = byId.get(d.businessId);
    if (!b || !terms) continue;
    const { aprPct, termMonths, amount } = terms;
    const path = simulateLoanPath({
      seed: b.id + ":perf", risk: b.hidden.risk, principal: amount, aprPct, termMonths,
      originationMonth: b.application.appMonth, throughMonth: AS_OF_MONTH,
      avgMonthlyRevenue: d.inputs.attributes.avgMonthlyRevenue,
      shockMonth: b.hidden.shockMonth, shockSize: b.hidden.shockSize, stackingMonth: b.hidden.stackingMonth,
    });
    const last = path[path.length - 1];
    loans.push({
      id: `LN-${b.id.slice(4)}`, businessId: b.id, businessName: b.name, decisionId: d.id, band: d.band, score: d.score,
      amount, aprPct, termMonths, payment: amortPayment(amount, aprPct, termMonths),
      originationMonth: b.application.appMonth, path,
      bucket: last?.bucket ?? "current", balance: last ? last.balance : amount,
      chargedOff: path.reduce((s, m) => s + m.chargeOff, 0), ever30: path.some((m) => is30Plus(m.bucket)),
    });
  }
  return loans.sort((a, b) => a.originationMonth.localeCompare(b.originationMonth));
}

export function stateAt(loan: Loan, month: string): { bucket: Bucket; balance: number } | null {
  const mob = monthDiff(loan.originationMonth, month);
  if (mob < 0) return null;
  if (mob === 0) return { bucket: "current", balance: loan.amount };
  const m = loan.path[mob - 1];
  if (m) return { bucket: m.bucket, balance: m.balance };
  const last = loan.path[loan.path.length - 1];
  return last ? { bucket: last.bucket, balance: 0 } : null;
}

export const isOpen = (b: Bucket) => b !== "chargedoff" && b !== "paidoff";

// ---------- Monitoring triggers ----------

export type Severity = "high" | "medium" | "low";
export interface Trigger {
  loanId: string;
  businessId: string;
  businessName: string;
  code: string;
  severity: Severity;
  text: string;
}

export function accountTriggers(loan: Loan, b: Business): Trigger[] {
  const out: Trigger[] = [];
  if (!isOpen(loan.bucket)) return out;
  const pre = b.months.filter((m) => m.phase === "pre");
  const post = b.months.filter((m) => m.phase === "post");
  const preRev = pre.reduce((s, m) => s + m.revenue, 0) / Math.max(pre.length, 1);
  const preDebt = pre.reduce((s, m) => s + m.debtPayments, 0) / Math.max(pre.length, 1);
  const last2 = post.slice(-2);
  const last = post[post.length - 1];
  const t = (code: string, severity: Severity, text: string) => out.push({ loanId: loan.id, businessId: b.id, businessName: b.name, code, severity, text });
  if (loan.bucket !== "current") t("DPD", "high", `Account is ${loan.bucket.replace("dpd", "").replace("_", "–").replace("p", "+")} days past due.`);
  if (last2.length === 2) {
    const r = last2.reduce((s, m) => s + m.revenue, 0) / 2;
    const chg = (r / preRev - 1) * 100;
    if (chg <= -30) t("REV-DROP", "high", `Revenue over the last 2 months is ${chg.toFixed(0)}% vs. the underwriting average.`);
    else if (chg <= -15) t("REV-SOFT", "low", `Revenue over the last 2 months is ${chg.toFixed(0)}% vs. the underwriting average.`);
  }
  if (last && last.nsfCount >= 3) t("NSF", "medium", `${last.nsfCount} NSF / overdraft events in ${last.month}.`);
  if (last && last.endBalance < loan.payment) t("LOW-BAL", "medium", `Month-end balance $${Math.round(last.endBalance).toLocaleString("en-US")} is below one loan payment ($${Math.round(loan.payment).toLocaleString("en-US")}).`);
  if (last && last.debtPayments > preDebt * 1.5 + 500) t("STACK", "medium", `New debt service detected: $${Math.round(last.debtPayments).toLocaleString("en-US")}/mo vs. $${Math.round(preDebt).toLocaleString("en-US")} at underwriting (possible stacking).`);
  return out;
}

// ---------- Vintage & roll rates ----------

export interface VintageRow {
  vintage: string;
  loans: number;
  amount: number;
  /** Cumulative % of loans ever 30+ DPD by MOB (index 0 = MOB 1); null where not yet observed. */
  cum30: (number | null)[];
}

export function vintageTable(loans: Loan[], maxMob = 12): VintageRow[] {
  const vintages = [...new Set(loans.map((l) => l.originationMonth))].sort();
  return vintages.map((v) => {
    const ls = loans.filter((l) => l.originationMonth === v);
    const observed = monthDiff(v, AS_OF_MONTH);
    const cum30: (number | null)[] = [];
    for (let mob = 1; mob <= maxMob; mob++) {
      if (mob > observed) { cum30.push(null); continue; }
      const hit = ls.filter((l) => l.path.slice(0, mob).some((m) => is30Plus(m.bucket))).length;
      cum30.push(ls.length ? (hit / ls.length) * 100 : 0);
    }
    return { vintage: v, loans: ls.length, amount: ls.reduce((s, l) => s + l.amount, 0), cum30 };
  });
}

export const ROLL_FROM: Bucket[] = ["current", "dpd1_30", "dpd31_60", "dpd61_90", "dpd90p"];
export const ROLL_TO: Bucket[] = [...BUCKETS];

/** Balance-weighted transition matrix from month-1 to month, normalised by the opening balance per row. */
export function rollMatrix(loans: Loan[], month: string): { matrix: number[][]; opening: number[]; counts: number[][] } {
  const prev = addMonths(month, -1);
  const sums = ROLL_FROM.map(() => ROLL_TO.map(() => 0));
  const counts = ROLL_FROM.map(() => ROLL_TO.map(() => 0));
  const opening = ROLL_FROM.map(() => 0);
  for (const l of loans) {
    const a = stateAt(l, prev);
    const b = stateAt(l, month);
    if (!a || !b) continue;
    const i = ROLL_FROM.indexOf(a.bucket);
    if (i < 0) continue;
    const j = ROLL_TO.indexOf(b.bucket);
    sums[i][j] += a.balance;
    counts[i][j] += 1;
    opening[i] += a.balance;
  }
  return { matrix: sums.map((row, i) => row.map((v) => (opening[i] ? v / opening[i] : 0))), opening, counts };
}

export function avgRollMatrix(loans: Loan[], months = 6): number[][] {
  return avgRollWithExposure(loans, months).matrix;
}

function avgRollWithExposure(loans: Loan[], months = 6): { matrix: number[][]; opening: number[] } {
  const acc = ROLL_FROM.map(() => ROLL_TO.map(() => 0));
  const open = ROLL_FROM.map(() => 0);
  for (let k = 0; k < months; k++) {
    const m = addMonths(AS_OF_MONTH, -k);
    const prev = addMonths(m, -1);
    for (const l of loans) {
      const a = stateAt(l, prev);
      const b = stateAt(l, m);
      if (!a || !b) continue;
      const i = ROLL_FROM.indexOf(a.bucket);
      if (i < 0) continue;
      acc[i][ROLL_TO.indexOf(b.bucket)] += a.balance;
      open[i] += a.balance;
    }
  }
  return { matrix: acc.map((row, i) => row.map((v) => (open[i] ? v / open[i] : 0))), opening: open };
}

/**
 * Benchmark monthly roll rates for small-business term loans (rows = from, cols = ROLL_TO order:
 * current, 1–30, 31–60, 61–90, 90+, charged off, paid off). Used as the credibility prior.
 */
export const BENCHMARK_ROLL: number[][] = [
  [0.965, 0.025, 0, 0, 0, 0, 0.01],
  [0.45, 0, 0.55, 0, 0, 0, 0],
  [0.2, 0, 0.1, 0.7, 0, 0, 0],
  [0.08, 0, 0, 0.07, 0.85, 0, 0],
  [0, 0, 0, 0, 0.1, 0.9, 0],
];
/** Opening balance (summed over the 6-month window) at which observed rates get 50% weight. */
export const CREDIBILITY_K = 1_000_000;

export function blendedRollMatrix(loans: Loan[]): { matrix: number[][]; weights: number[] } {
  const { matrix, opening } = avgRollWithExposure(loans);
  const weights = opening.map((o) => o / (o + CREDIBILITY_K));
  return { matrix: matrix.map((row, i) => row.map((v, j) => weights[i] * v + (1 - weights[i]) * BENCHMARK_ROLL[i][j])), weights };
}

// ---------- Delinquency trend ----------

export interface MonthPoint {
  month: string;
  outstanding: number;
  dpd30plus: number;
  dpd30Rate: number;
  chargeOffs: number;
  originations: number;
  originationCount: number;
}

export function monthlyTrend(loans: Loan[]): MonthPoint[] {
  const first = loans[0]?.originationMonth ?? AS_OF_MONTH;
  return monthRange(first, AS_OF_MONTH).map((month) => {
    let outstanding = 0, d30 = 0, co = 0, orig = 0, origN = 0;
    for (const l of loans) {
      const s = stateAt(l, month);
      if (!s) continue;
      if (l.originationMonth === month) { orig += l.amount; origN++; }
      const mob = monthDiff(l.originationMonth, month);
      if (mob > 0) co += l.path[mob - 1]?.chargeOff ?? 0;
      if (!isOpen(s.bucket)) continue;
      outstanding += s.balance;
      if (is30Plus(s.bucket)) d30 += s.balance;
    }
    return { month, outstanding, dpd30plus: d30, dpd30Rate: outstanding ? (d30 / outstanding) * 100 : 0, chargeOffs: co, originations: orig, originationCount: origN };
  });
}

// ---------- Collections & loss forecast ----------

export interface CollectionsStage {
  id: string;
  name: string;
  buckets: Bucket[];
  dpd: string;
  strategy: string[];
  owner: string;
}

export const COLLECTION_STAGES: CollectionsStage[] = [
  { id: "early", name: "Early", buckets: ["dpd1_30"], dpd: "1–30", owner: "Automated + servicing team",
    strategy: ["Day 1: automated email/SMS with payment link", "Day 5: retry ACH after payday", "Day 10: servicing call, confirm cause (timing vs. distress)", "Promise-to-pay logged; 7-day follow-up"] },
  { id: "mid", name: "Mid", buckets: ["dpd31_60"], dpd: "31–60", owner: "Collections specialist",
    strategy: ["Hardship assessment with fresh bank data pull", "Short-term payment plan (interest-only up to 60 days)", "Pause new draws / renewals", "Escalate if no contact in 10 days"] },
  { id: "late", name: "Late", buckets: ["dpd61_90"], dpd: "61–90", owner: "Workout team",
    strategy: ["Formal restructure or term extension", "Demand letter; personal guarantee notice", "UCC lien and collateral review", "Charge-off recommendation prepared"] },
  { id: "precharge", name: "Pre charge-off", buckets: ["dpd90p"], dpd: "90+", owner: "Recovery",
    strategy: ["Charge-off at 120 DPD per policy", "Settlement offers within delegated authority", "Agency or legal placement", "Recovery tracked against 15% assumption"] },
];

export const RECOVERY_RATE = 0.15;

export interface LossForecastPoint {
  month: string;
  grossChargeOff: number;
  netLoss: number;
  cumulativeNet: number;
  balances: Record<string, number>;
}

/**
 * Run-off forecast: current balances by bucket rolled forward with the 6-month average balance-weighted
 * roll matrix, credibility-blended with BENCHMARK_ROLL (thin rows lean on the benchmark). Current balances also amortise at the observed scheduled-paydown rate. No new originations.
 */
export function lossForecast(loans: Loan[], horizon = 12): { points: LossForecastPoint[]; matrix: number[][]; weights: number[]; amortRate: number; startBalance: number } {
  const { matrix, weights } = blendedRollMatrix(loans);
  // observed paydown of loans that stayed current
  let paid = 0, base = 0;
  for (let k = 0; k < 6; k++) {
    const m = addMonths(AS_OF_MONTH, -k);
    for (const l of loans) {
      const a = stateAt(l, addMonths(m, -1));
      const b = stateAt(l, m);
      if (a?.bucket === "current" && b?.bucket === "current") { paid += a.balance - b.balance; base += a.balance; }
    }
  }
  const amortRate = base ? paid / base : 0.06;
  let bal = ROLL_FROM.map((bk) => loans.filter((l) => l.bucket === bk).reduce((s, l) => s + l.balance, 0));
  const startBalance = bal.reduce((a, b) => a + b, 0);
  const coIdx = ROLL_TO.indexOf("chargedoff");
  const points: LossForecastPoint[] = [];
  let cum = 0;
  for (let h = 1; h <= horizon; h++) {
    const next = ROLL_FROM.map(() => 0);
    let co = 0;
    bal.forEach((v, i) => {
      matrix[i].forEach((p, j) => {
        const to = ROLL_TO[j];
        if (j === coIdx) co += v * p;
        const fi = ROLL_FROM.indexOf(to);
        if (fi >= 0) next[fi] += v * p * (to === "current" ? 1 - amortRate : 1);
      });
    });
    bal = next;
    const net = co * (1 - RECOVERY_RATE);
    cum += net;
    points.push({ month: addMonths(AS_OF_MONTH, h), grossChargeOff: co, netLoss: net, cumulativeNet: cum, balances: Object.fromEntries(ROLL_FROM.map((b, i) => [b, bal[i]])) });
  }
  return { points, matrix, weights, amortRate, startBalance };
}

// ---------- Model validation ----------

export interface Validation {
  n: number;
  bads: number;
  auc: number;
  gini: number;
  ks: number;
  byBand: { band: Band; n: number; bads: number; badRate: number }[];
}

export function validateScorecard(rows: { score: number; band: Band; bad: boolean }[]): Validation {
  const n = rows.length;
  const bads = rows.filter((r) => r.bad).length;
  const goods = n - bads;
  // AUC: probability a random good scores above a random bad (ties count half)
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  let rankSumGood = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (!sorted[k].bad) rankSumGood += avgRank;
    i = j;
  }
  const auc = goods && bads ? (rankSumGood - (goods * (goods + 1)) / 2) / (goods * bads) : 0.5;
  let cg = 0, cb = 0, ks = 0;
  for (const r of sorted) {
    if (r.bad) cb++; else cg++;
    ks = Math.max(ks, Math.abs(cb / Math.max(bads, 1) - cg / Math.max(goods, 1)));
  }
  const byBand = (["A", "B", "C", "D", "E"] as Band[]).map((band) => {
    const rs = rows.filter((r) => r.band === band);
    const b = rs.filter((r) => r.bad).length;
    return { band, n: rs.length, bads: b, badRate: rs.length ? (b / rs.length) * 100 : 0 };
  });
  return { n, bads, auc, gini: 2 * auc - 1, ks: ks * 100, byBand };
}
