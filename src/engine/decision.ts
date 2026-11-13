// Module 7: decision flow. Rules and the scorecard decide; humans can resolve reviews or override.
// The AI assistant has no path into this module.
import { computeAttributes } from "./attributes";
import { kycOutcome } from "./kyc";
import {
  adverseReasons, evaluateKnockouts, knockoutReason, scoreApplicant, scoreReasonText,
  type Band, type CreditPolicy, type ScoreLine,
} from "./policy";
import { calcOffer, type OfferCalc } from "./pricing";
import { hashStr } from "./rng";
import { amortPayment } from "./loanSim";
import type { Application, Attributes, Business, KycStatus } from "./types";

export type Outcome = "APPROVE" | "DECLINE" | "REVIEW";
export type FinalStatus = "APPROVED" | "DECLINED" | "PENDING_REVIEW";

export interface Reason {
  code: string;
  stage: "kyc" | "policy" | "score" | "affordability" | "review" | "offer" | "human";
  text: string;
}

export interface HumanAction {
  by: string;
  at: string;
  /** "review" = resolving a REVIEW; "override" = reversing an automated APPROVE / DECLINE. */
  kind: "review" | "override";
  action: "APPROVE" | "DECLINE";
  reasons: Reason[];
  note: string;
  /** Terms booked on a human approval (engine offer, possibly reduced, or override pricing). */
  offer?: OfferCalc;
}

export interface Decision {
  id: string;
  businessId: string;
  businessName: string;
  applicationId: string;
  decidedAt: string;
  policyVersion: string;
  inputs: {
    application: Application;
    attributes: Attributes;
    kyc: { id: string; name: string; status: KycStatus }[];
  };
  kycOutcome: KycStatus;
  knockouts: { ruleId: string; attribute: string; operator: string; threshold: number; value: number; hit: boolean }[];
  score: number;
  band: Band;
  scoreLines: ScoreLine[];
  offer: OfferCalc | null;
  engineOutcome: Outcome;
  reasons: Reason[];
  human?: HumanAction;
}

export function finalStatus(d: Decision): FinalStatus {
  if (d.human) return d.human.action === "APPROVE" ? "APPROVED" : "DECLINED";
  if (d.engineOutcome === "REVIEW") return "PENDING_REVIEW";
  return d.engineOutcome === "APPROVE" ? "APPROVED" : "DECLINED";
}

/** Terms actually booked for an approved decision. */
export function bookedTerms(d: Decision): OfferCalc | null {
  if (finalStatus(d) !== "APPROVED") return null;
  const o = d.human?.offer ?? d.offer;
  return o && o.amount > 0 ? o : null;
}

/** Re-price an offer at a different amount (analyst reduction or override approval). */
export function offerAtAmount(policy: CreditPolicy, d: Decision, amount: number): OfferCalc {
  const band: Band = d.band === "E" ? "D" : d.band;
  const base = d.offer && d.offer.amount > 0 ? d.offer : calcOffer(policy, band, d.inputs.attributes, d.inputs.application.requestedAmount, d.inputs.application.requestedTermMonths);
  const aprPct = base.aprPct || policy.pricing.apr[band][base.termMonths];
  const monthlyPayment = amortPayment(amount, aprPct, base.termMonths);
  const a = d.inputs.attributes;
  return { ...base, band, aprPct, amount, monthlyPayment, dscrAfter: a.netOperatingCashFlow / Math.max(a.existingDebtMonthly + monthlyPayment, 1) };
}

export function decide(b: Business, policy: CreditPolicy, decidedAt: string): Decision {
  const a = computeAttributes(b);
  const app = b.application;
  const kyc = kycOutcome(b.kyc);
  const ko = evaluateKnockouts(policy, a);
  const sr = scoreApplicant(policy.scorecard, a);
  const sc = policy.scorecard;
  const reasons: Reason[] = [];
  let outcome: Outcome;
  let offer: OfferCalc | null = null;

  const fails = b.kyc.filter((c) => c.status === "fail");
  const refers = b.kyc.filter((c) => c.status === "refer");
  const hits = ko.filter((r) => r.hit);

  if (kyc === "fail") {
    outcome = "DECLINE";
    for (const c of fails) reasons.push({ code: `KYC-${c.id.toUpperCase()}`, stage: "kyc", text: `${c.name} could not be verified: ${c.detail}` });
  } else if (hits.length) {
    outcome = "DECLINE";
    for (const h of hits) reasons.push({ code: h.rule.reasonCode, stage: "policy", text: knockoutReason(h) });
  } else if (sr.score < sc.declineCutoff) {
    outcome = "DECLINE";
    reasons.push({ code: "SC-CUTOFF", stage: "score", text: `Score ${sr.score} is below the decline cutoff of ${sc.declineCutoff}. Main factors:` });
    for (const l of adverseReasons(sr)) reasons.push({ code: `SC-${l.attribute}`, stage: "score", text: scoreReasonText(l) });
  } else {
    offer = calcOffer(policy, sr.band, a, app.requestedAmount, app.requestedTermMonths);
    if (offer.amount === 0) {
      outcome = "DECLINE";
      reasons.push({
        code: "AFF-CAP", stage: "affordability",
        text: `Cash flow supports a new payment of at most $${Math.round(offer.maxAffordablePayment).toLocaleString("en-US")}/month after existing debt service of $${Math.round(a.existingDebtMonthly).toLocaleString("en-US")}/month, below the $${policy.pricing.minLoan.toLocaleString("en-US")} minimum loan.`,
      });
    } else {
      const review: Reason[] = [];
      if (kyc === "refer") for (const c of refers) review.push({ code: `KYC-${c.id.toUpperCase()}`, stage: "review", text: `${c.name} needs analyst review: ${c.detail}` });
      if (sr.score < sc.approveCutoff) review.push({ code: "SC-REVIEW", stage: "review", text: `Score ${sr.score} is in the manual review range (${sc.declineCutoff}–${sc.approveCutoff - 1}).` });
      if (offer.amount > policy.pricing.manualReviewAbove) review.push({ code: "EXP-LARGE", stage: "review", text: `Offer of $${offer.amount.toLocaleString("en-US")} exceeds the $${policy.pricing.manualReviewAbove.toLocaleString("en-US")} auto-approval exposure limit.` });
      if (Math.abs(a.statedRevenueVariancePct) > 25) review.push({ code: "DOC-REV", stage: "review", text: `Stated annual revenue differs from bank-verified revenue by ${a.statedRevenueVariancePct.toFixed(0)}%.` });
      outcome = review.length ? "REVIEW" : "APPROVE";
      reasons.push(...review);
      reasons.push({
        code: `OFFER-${offer.bindingConstraint.toUpperCase()}`, stage: "offer",
        text: offer.amount < app.requestedAmount
          ? `Offer $${offer.amount.toLocaleString("en-US")} vs. $${app.requestedAmount.toLocaleString("en-US")} requested; limited by ${constraintLabel(offer.bindingConstraint)}.`
          : `Full requested amount supported: band ${sr.band}, ${offer.termMonths} months at ${offer.aprPct}% APR, DSCR after loan ${offer.dscrAfter.toFixed(2)}x.`,
      });
    }
  }

  const id = `DEC-${(hashStr(b.id + policy.version + decidedAt) % 0xffffff).toString(16).toUpperCase().padStart(6, "0")}`;
  return {
    id, businessId: b.id, businessName: b.name, applicationId: app.id, decidedAt, policyVersion: policy.version,
    inputs: { application: app, attributes: a, kyc: b.kyc.map((c) => ({ id: c.id, name: c.name, status: c.status })) },
    kycOutcome: kyc,
    knockouts: ko.map((r) => ({ ruleId: r.rule.id, attribute: r.rule.attribute, operator: r.rule.operator, threshold: r.rule.threshold, value: r.value, hit: r.hit })),
    score: sr.score, band: sr.band, scoreLines: sr.lines, offer, engineOutcome: outcome, reasons,
  };
}

export function constraintLabel(c: OfferCalc["bindingConstraint"]): string {
  return { requested: "the requested amount", grid: "the band limit grid (% of annual revenue)", affordability: "the affordability cap", max_loan: "the program maximum", none: "no eligible pricing" }[c];
}

/** Reason codes an analyst may pick when declining in review or overriding to decline. */
export const HUMAN_DECLINE_REASONS: Reason[] = [
  { code: "HUM-CASH", stage: "human", text: "Cash flow is insufficient to support the requested payment." },
  { code: "HUM-DOCS", stage: "human", text: "Documents provided could not verify stated revenue." },
  { code: "HUM-KYC", stage: "human", text: "Identity or business verification could not be completed." },
  { code: "HUM-INDUSTRY", stage: "human", text: "Industry or business model risk outside appetite." },
  { code: "HUM-DEBT", stage: "human", text: "Existing obligations are too high relative to revenue." },
  { code: "HUM-CONC", stage: "human", text: "Revenue is too dependent on a single customer." },
];
