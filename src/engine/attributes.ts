// Module 3: attribute engine. Derives underwriting attributes from the 12-month pre-application bank window
// and application data only. It never reads Business.hidden or the outcome label.
import { industryByName } from "./data";
import type { AttributeKey, Attributes, Business, MonthSummary } from "./types";

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

export function underwritingWindow(b: Pick<Business, "months">): MonthSummary[] {
  return b.months.filter((m) => m.phase === "pre");
}

export function computeAttributes(b: Business): Attributes {
  const w = underwritingWindow(b);
  const rev = w.map((m) => m.revenue);
  const avgRev = mean(rev);
  const first6 = mean(rev.slice(0, 6));
  const last6 = mean(rev.slice(-6));
  const opex = mean(w.map((m) => m.operatingExpenses));
  const debt = mean(w.map((m) => m.debtPayments));
  const totalRev = rev.reduce((a, b) => a + b, 0);
  const topPayer = Math.max(0, ...Object.values(b.payerTotals));
  const avgBal = mean(w.slice(-3).map((m) => m.avgBalance));
  return {
    monthsInBusiness: b.monthsInBusiness,
    ownerCreditScore: b.owner.creditScore,
    avgMonthlyRevenue: avgRev,
    revenueTrendPct: first6 > 0 ? (last6 / first6 - 1) * 100 : 0,
    revenueVolatility: avgRev > 0 ? sd(rev) / avgRev : 1,
    // average daily balance over the last 3 months divided by average daily operating outflow
    daysCashOnHand: Math.max(0, avgBal) / Math.max((opex + debt) / 30, 1),
    nsfCount12m: w.reduce((a, m) => a + m.nsfCount, 0),
    nsfCount3m: w.slice(-3).reduce((a, m) => a + m.nsfCount, 0),
    existingDebtMonthly: debt,
    debtServiceRatio: avgRev > 0 ? (debt / avgRev) * 100 : 100,
    customerConcentration: totalRev > 0 ? (topPayer / totalRev) * 100 : 0,
    netOperatingCashFlow: avgRev - opex,
    negativeBalanceDays: w.reduce((a, m) => a + m.negativeDays, 0),
    restrictedIndustry: industryByName(b.industry).restricted ? 1 : 0,
    statedRevenueVariancePct: totalRev > 0 ? (b.application.statedAnnualRevenue / totalRev - 1) * 100 : 0,
  };
}

export interface AttributeMeta {
  key: AttributeKey;
  label: string;
  unit: "usd" | "pct" | "count" | "days" | "months" | "ratio" | "score" | "flag";
  help: string;
}

export const ATTRIBUTE_META: AttributeMeta[] = [
  { key: "avgMonthlyRevenue", label: "Avg monthly revenue", unit: "usd", help: "Mean of monthly sales deposits over the 12-month window. Excludes owner contributions and transfers." },
  { key: "revenueTrendPct", label: "Revenue trend", unit: "pct", help: "Average of the last 6 months vs. the first 6 months of the window." },
  { key: "revenueVolatility", label: "Revenue volatility", unit: "ratio", help: "Coefficient of variation of monthly revenue (std dev / mean)." },
  { key: "daysCashOnHand", label: "Days of cash", unit: "days", help: "Average daily balance (last 3 months) divided by average daily outflow (opex + debt service)." },
  { key: "nsfCount12m", label: "NSF / overdraft events (12m)", unit: "count", help: "Returned items and overdrafts over the window." },
  { key: "nsfCount3m", label: "NSF / overdraft events (3m)", unit: "count", help: "Returned items and overdrafts in the last 3 months." },
  { key: "existingDebtMonthly", label: "Existing debt service", unit: "usd", help: "Average monthly payments to other lenders and advance providers detected in the bank data." },
  { key: "debtServiceRatio", label: "Debt service / revenue", unit: "pct", help: "Existing monthly debt service as a share of average monthly revenue." },
  { key: "customerConcentration", label: "Customer concentration", unit: "pct", help: "Largest single payer's share of revenue. Card-processor settlements are not a customer." },
  { key: "netOperatingCashFlow", label: "Net operating cash flow", unit: "usd", help: "Avg monthly revenue minus operating expenses, before debt service." },
  { key: "negativeBalanceDays", label: "Negative balance days", unit: "days", help: "Days the account closed below zero during the window." },
  { key: "monthsInBusiness", label: "Time in business", unit: "months", help: "From application (verified against SoS formation date in production)." },
  { key: "ownerCreditScore", label: "Owner credit score", unit: "score", help: "Mock bureau score of the principal owner." },
  { key: "restrictedIndustry", label: "Restricted industry", unit: "flag", help: "1 if the industry is on the restricted list." },
  { key: "statedRevenueVariancePct", label: "Stated vs. verified revenue", unit: "pct", help: "Applicant-stated annual revenue vs. bank-verified revenue." },
];

export const attrMeta = (k: AttributeKey) => ATTRIBUTE_META.find((m) => m.key === k)!;

export function formatAttr(k: AttributeKey, v: number): string {
  const u = attrMeta(k).unit;
  switch (u) {
    case "usd": return `$${Math.round(v).toLocaleString("en-US")}`;
    case "pct": return `${v.toFixed(1)}%`;
    case "ratio": return v.toFixed(2);
    case "days": return `${Math.round(v)} days`;
    case "months": return `${Math.round(v)} mo`;
    case "flag": return v ? "Yes" : "No";
    default: return `${Math.round(v)}`;
  }
}
