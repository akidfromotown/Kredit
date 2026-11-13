// Module 11: AI assistant (demo mode).
// Guardrail by construction: every function here takes read-only data and returns text. None of them
// returns an outcome, writes a decision or is imported by decision.ts. In production these templates
// would be replaced by an LLM call made from a server-side function with the same inputs and outputs.
import { attrMeta, formatAttr } from "./attributes";
import { finalStatus, type Decision } from "./decision";
import type { Loan, Trigger } from "./portfolio";
import type { Business } from "./types";

export type AiTask = "screen_documents" | "credit_memo" | "explain_decline" | "summarize_warnings";

export const AI_TASK_LABEL: Record<AiTask, string> = {
  screen_documents: "Document screen",
  credit_memo: "Credit memo draft",
  explain_decline: "Decline explanation",
  summarize_warnings: "Warning summary",
};

export interface AiOutput {
  task: AiTask;
  title: string;
  /** Markdown-light text: lines starting with "## " are headings, "- " are bullets. */
  body: string;
  /** Data fields the text was grounded on. */
  grounding: string[];
  disclaimer: string;
}

const DISCLAIMER = "AI-generated draft for analyst use. It does not approve, decline or change any decision.";
const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

export interface Finding {
  severity: "concern" | "watch" | "info";
  text: string;
}

export function documentFindings(b: Business, d: Decision): Finding[] {
  const a = d.inputs.attributes;
  const pre = b.months.filter((m) => m.phase === "pre");
  const f: Finding[] = [];
  f.push({ severity: "info", text: `Bank statements cover ${pre.length} of 12 required months (${pre[0]?.month} to ${pre[pre.length - 1]?.month}); no gaps detected.` });
  const v = a.statedRevenueVariancePct;
  if (Math.abs(v) > 25) f.push({ severity: "concern", text: `Stated annual revenue (${usd(b.application.statedAnnualRevenue)}) is ${v.toFixed(0)}% ${v > 0 ? "above" : "below"} bank-verified revenue (${usd(a.avgMonthlyRevenue * 12)}). Request tax returns or processor statements.` });
  else if (Math.abs(v) > 10) f.push({ severity: "watch", text: `Stated revenue differs from bank-verified revenue by ${v.toFixed(0)}%. Within tolerance but worth confirming.` });
  else f.push({ severity: "info", text: `Stated revenue reconciles to bank deposits within ${Math.abs(v).toFixed(0)}%.` });
  const contrib = pre.reduce((s, m) => s + m.ownerContributions, 0);
  if (contrib > 0) f.push({ severity: "watch", text: `Owner capital contributions of ${usd(contrib)} in the window. These were excluded from revenue; they may be masking cash shortfalls.` });
  if (b.hidden.debt && a.existingDebtMonthly > 0) {
    f.push({ severity: b.hidden.debt.kind === "mca" ? "concern" : "watch", text: `Recurring ${b.hidden.debt.kind === "mca" ? "daily remittances" : "monthly payments"} to ${b.hidden.debt.lender} (~${usd(a.existingDebtMonthly)}/mo). Confirm the obligation is disclosed on the application and get a payoff letter if refinancing.` });
  }
  const nsfMonths = pre.filter((m) => m.nsfCount > 0).map((m) => m.month);
  if (nsfMonths.length) f.push({ severity: nsfMonths.length > 3 ? "concern" : "watch", text: `NSF / overdraft activity in ${nsfMonths.length} month(s): ${nsfMonths.join(", ")}.` });
  if (a.customerConcentration > 40) f.push({ severity: "watch", text: `Largest payer accounts for ${a.customerConcentration.toFixed(0)}% of deposits. Ask for the customer contract and its term.` });
  if (a.negativeBalanceDays > 10) f.push({ severity: "watch", text: `Account closed negative on ${a.negativeBalanceDays} days.` });
  return f;
}

export function screenDocuments(b: Business, d: Decision): AiOutput {
  const f = documentFindings(b, d);
  const order = { concern: 0, watch: 1, info: 2 };
  const lines = [...f].sort((x, y) => order[x.severity] - order[y.severity]).map((x) => `- [${x.severity}] ${x.text}`);
  const concerns = f.filter((x) => x.severity === "concern").length;
  return {
    task: "screen_documents",
    title: `Document screen — ${b.name}`,
    body: [
      `## Summary`,
      concerns ? `${concerns} item(s) need follow-up before funding.` : `No material inconsistencies between the application and bank data.`,
      `## Findings`,
      ...lines,
    ].join("\n"),
    grounding: ["application.statedAnnualRevenue", "bank months (pre-application)", "attributes", "detected debt payees"],
    disclaimer: DISCLAIMER,
  };
}

export function draftCreditMemo(b: Business, d: Decision): AiOutput {
  const a = d.inputs.attributes;
  const app = d.inputs.application;
  const top = [...d.scoreLines].sort((x, y) => y.points / y.maxPoints - x.points / x.maxPoints);
  const strengths = top.slice(0, 3).filter((l) => l.points / l.maxPoints >= 0.6);
  const weaknesses = top.slice(-3).reverse().filter((l) => l.points / l.maxPoints < 0.6);
  const status = finalStatus(d);
  const o = d.offer;
  return {
    task: "credit_memo",
    title: `Credit memo — ${b.name}`,
    body: [
      `## Request`,
      `${b.name} (${b.entityType}, ${b.state}) requests ${usd(app.requestedAmount)} over ${app.requestedTermMonths} months for ${app.purpose.toLowerCase()}. ${b.industry}, ${Math.round(b.monthsInBusiness / 12)} years in business. Principal: ${b.owner.name} (${b.owner.ownershipPct}%).`,
      `## Cash flow (12 months, bank-verified)`,
      `- Average monthly revenue ${formatAttr("avgMonthlyRevenue", a.avgMonthlyRevenue)}, trend ${formatAttr("revenueTrendPct", a.revenueTrendPct)}, volatility ${formatAttr("revenueVolatility", a.revenueVolatility)}.`,
      `- Net operating cash flow ${usd(a.netOperatingCashFlow)}/mo; existing debt service ${usd(a.existingDebtMonthly)}/mo (${a.debtServiceRatio.toFixed(1)}% of revenue).`,
      `- ${Math.round(a.daysCashOnHand)} days of cash on hand; ${a.nsfCount12m} NSF / overdraft events; top customer ${a.customerConcentration.toFixed(0)}% of revenue.`,
      `## Policy and score`,
      `- Policy ${d.policyVersion}: ${d.knockouts.filter((k) => k.hit).length} of ${d.knockouts.length} knockout rules triggered. KYC/KYB: ${d.kycOutcome}.`,
      `- Score ${d.score}, band ${d.band}.`,
      o && o.amount ? `- Offer: ${usd(o.amount)} at ${o.aprPct}% APR for ${o.termMonths} months (${usd(o.monthlyPayment)}/mo); DSCR after loan ${o.dscrAfter.toFixed(2)}x; limited by ${o.bindingConstraint}.` : `- No offer generated.`,
      `## Strengths`,
      ...(strengths.length ? strengths.map((l) => `- ${attrMeta(l.attribute).label}: ${formatAttr(l.attribute, l.value)}.`) : ["- None stand out against the scorecard."]),
      `## Risks and mitigants`,
      ...(weaknesses.length ? weaknesses.map((l) => `- ${attrMeta(l.attribute).label}: ${formatAttr(l.attribute, l.value)}. Mitigant to confirm: ${mitigant(l.attribute)}`) : ["- No material weaknesses against the scorecard."]),
      `## Engine outcome`,
      `The rules engine and scorecard returned ${d.engineOutcome}${d.human ? `; an analyst then recorded ${d.human.action} (${d.human.kind})` : ""}. Current status: ${status.replace("_", " ").toLowerCase()}. This memo is a summary and does not change that outcome.`,
    ].join("\n"),
    grounding: ["decision.inputs", "decision.scoreLines", "decision.offer", "decision.knockouts"],
    disclaimer: DISCLAIMER,
  };
}

function mitigant(k: string): string {
  const m: Record<string, string> = {
    revenueTrendPct: "cause of decline (seasonal vs. structural) and current-month deposits.",
    revenueVolatility: "seasonality pattern and payment timing; consider seasonal payment schedule.",
    daysCashOnHand: "available credit lines or owner liquidity.",
    nsfCount12m: "whether NSFs were timing-related and have stopped.",
    debtServiceRatio: "payoff of existing obligations with proceeds.",
    customerConcentration: "length and terms of the contract with the largest customer.",
    ownerCreditScore: "derogatory items on the owner's bureau report.",
    monthsInBusiness: "owner's prior industry experience.",
    avgMonthlyRevenue: "loan size relative to revenue.",
  };
  return m[k] ?? "supporting documentation.";
}

const PLAIN: Record<string, (text: string) => string> = {
  "KO-TIB": () => "Your business has not been operating long enough yet. We currently require at least 12 months.",
  "KO-REV": () => "Your average monthly revenue is below the minimum we lend against.",
  "KO-NSF": () => "Your bank account showed several returned or overdrawn payments in the last three months.",
  "KO-CASH": () => "Your account balance would cover only a few days of your usual expenses.",
  "KO-TREND": () => "Your revenue has dropped sharply over the past year.",
  "KO-DSR": () => "A large share of your revenue already goes to paying other lenders.",
  "KO-FICO": () => "The owner's personal credit score is below our minimum.",
  "KO-CONC": () => "Most of your revenue comes from a single customer, which makes cash flow less predictable.",
  "KO-IND": () => "We don't currently lend to businesses in your industry.",
  "KO-MISREP": () => "The revenue on your application didn't match what your bank statements show.",
  "AFF-CAP": () => "After your existing payments, your cash flow can't comfortably support a new loan payment.",
};

const NEXT_STEP: Record<string, string> = {
  "KO-TIB": "Reapply once the business reaches 12 months of operating history.",
  "KO-REV": "Reapply when monthly revenue is consistently above $10,000.",
  "KO-NSF": "Three months without returned payments would put you back within policy.",
  "KO-CASH": "Building a cash reserve of at least a few weeks of expenses strengthens a future application.",
  "KO-TREND": "Reapply when recent months show revenue stabilizing.",
  "KO-DSR": "Paying down existing advances or loans would improve your eligibility.",
  "KO-FICO": "Reviewing the owner's credit report for errors may help.",
  "KO-CONC": "Diversifying your customer base improves eligibility.",
  "AFF-CAP": "A smaller amount or paying down existing debt may be possible later.",
};

export function explainDecline(b: Business, d: Decision): AiOutput {
  const declined = finalStatus(d) === "DECLINED";
  const reasons = d.human?.action === "DECLINE" ? d.human.reasons : d.reasons;
  const bullets = reasons.filter((r) => r.code !== "SC-CUTOFF").map((r) => {
    const p = PLAIN[r.code];
    if (p) return `- ${p(r.text)}`;
    if (r.stage === "score") return `- ${r.text.replace(/ scored .*$/, "")} was weaker than we look for.`;
    return `- ${r.text}`;
  });
  const steps = [...new Set(reasons.map((r) => NEXT_STEP[r.code]).filter(Boolean))];
  return {
    task: "explain_decline",
    title: declined ? `Decline explanation — ${b.name}` : `Explanation — ${b.name}`,
    body: declined
      ? [
          `Hi ${b.owner.name.split(" ")[0]},`,
          `Thank you for applying for a ${usd(d.inputs.application.requestedAmount)} business loan. We're not able to approve this application right now. The specific reasons are:`,
          ...bullets,
          ...(steps.length ? [`## What could help`, ...steps.map((s) => `- ${s}`)] : []),
          `You can request a copy of the information we used and reapply after 90 days. (Demo text: a real adverse action notice must follow ECOA / Reg B.)`,
        ].join("\n")
      : `This application was not declined (status: ${finalStatus(d).replace("_", " ").toLowerCase()}). There is nothing to explain to the applicant.`,
    grounding: ["decision.reasons (exact codes)", d.human ? "human.reasons" : "engine reasons"],
    disclaimer: DISCLAIMER + " Reasons come only from the stored decision; the assistant cannot add new ones.",
  };
}

export function summarizeWarnings(loans: Loan[], triggers: Trigger[], max = 8): AiOutput {
  const high = triggers.filter((t) => t.severity === "high");
  const byCode: Record<string, number> = {};
  triggers.forEach((t) => (byCode[t.code] = (byCode[t.code] ?? 0) + 1));
  const byLoan = new Map<string, Trigger[]>();
  triggers.forEach((t) => byLoan.set(t.loanId, [...(byLoan.get(t.loanId) ?? []), t]));
  const ranked = [...byLoan.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, max);
  const exposure = (id: string) => loans.find((l) => l.id === id)?.balance ?? 0;
  const atRisk = [...byLoan.keys()].reduce((s, id) => s + exposure(id), 0);
  const label: Record<string, string> = { DPD: "past due", "REV-DROP": "revenue drop >30%", "REV-SOFT": "revenue softening", NSF: "NSF spike", "LOW-BAL": "low balance", STACK: "new debt stacking" };
  return {
    task: "summarize_warnings",
    title: "Portfolio warning summary",
    body: [
      `## Overview`,
      `${byLoan.size} of ${loans.filter((l) => l.bucket !== "paidoff" && l.bucket !== "chargedoff").length} open accounts have at least one active trigger (${usd(atRisk)} outstanding). ${high.length} high-severity signals.`,
      `- ${Object.entries(byCode).map(([c, n]) => `${label[c] ?? c}: ${n}`).join("; ")}`,
      `## Accounts to look at first`,
      ...ranked.map(([id, ts]) => `- ${ts[0].businessName} (${id}, ${usd(exposure(id))}): ${ts.map((t) => t.text).join(" ")}`),
      `## Suggested focus`,
      byCode.STACK ? `- ${byCode.STACK} account(s) show new daily debits after funding. Stacking often comes before delinquency; consider an outreach call.` : `- No stacking signals this month.`,
      byCode["REV-DROP"] ? `- ${byCode["REV-DROP"]} account(s) have revenue down more than 30% since underwriting; request refreshed bank data before any renewal.` : `- No severe revenue drops.`,
    ].join("\n"),
    grounding: ["monitoring triggers", "loan balances"],
    disclaimer: DISCLAIMER,
  };
}

function score(ts: Trigger[]): number {
  return ts.reduce((s, t) => s + (t.severity === "high" ? 3 : t.severity === "medium" ? 2 : 1), 0);
}

