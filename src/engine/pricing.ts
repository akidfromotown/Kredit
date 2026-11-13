// Module 6: limit & pricing grid with an affordability cap.
import { amortPayment } from "./loanSim";
import type { Band, CreditPolicy } from "./policy";
import type { Attributes } from "./types";

export interface OfferCalc {
  band: Band;
  termMonths: number;
  aprPct: number;
  requested: number;
  gridLimit: number;
  maxAffordablePayment: number;
  affordabilityLimit: number;
  /** Final offer amount, rounded down to $1,000. 0 when no offer is possible. */
  amount: number;
  monthlyPayment: number;
  bindingConstraint: "requested" | "grid" | "affordability" | "max_loan" | "none";
  dscrAfter: number;
}

/** Principal that a given monthly payment supports at the APR and term. */
export function principalForPayment(payment: number, aprPct: number, termMonths: number): number {
  if (payment <= 0) return 0;
  return payment / amortPayment(1, aprPct, termMonths);
}

export function calcOffer(policy: CreditPolicy, band: Band, a: Attributes, requested: number, requestedTerm: number): OfferCalc {
  const { pricing, affordability } = policy;
  const termMonths = pricing.terms.includes(requestedTerm) ? requestedTerm : 12;
  const aprPct = pricing.apr[band][termMonths] ?? 0;
  const annualRevenue = a.avgMonthlyRevenue * 12;
  const gridLimit = (annualRevenue * pricing.limitPctOfRevenue[band]) / 100;
  const dscrRoom = a.netOperatingCashFlow / affordability.minDscr - a.existingDebtMonthly;
  const revenueRoom = (a.avgMonthlyRevenue * affordability.maxPaymentPctRevenue) / 100;
  const maxAffordablePayment = Math.max(0, Math.min(dscrRoom, revenueRoom));
  const affordabilityLimit = aprPct > 0 ? principalForPayment(maxAffordablePayment, aprPct, termMonths) : 0;

  const caps: [OfferCalc["bindingConstraint"], number][] = [
    ["requested", requested],
    ["grid", gridLimit],
    ["affordability", affordabilityLimit],
    ["max_loan", pricing.maxLoan],
  ];
  let [binding, raw] = caps[0];
  for (const [k, v] of caps) if (v < raw) { binding = k; raw = v; }
  let amount = Math.floor(raw / 1000) * 1000;
  if (amount < pricing.minLoan || aprPct <= 0) { amount = 0; binding = aprPct <= 0 ? "none" : binding; }
  const monthlyPayment = amount ? amortPayment(amount, aprPct, termMonths) : 0;
  const dscrAfter = a.netOperatingCashFlow / Math.max(a.existingDebtMonthly + monthlyPayment, 1);
  return { band, termMonths, aprPct, requested, gridLimit, maxAffordablePayment, affordabilityLimit, amount, monthlyPayment, bindingConstraint: binding, dscrAfter };
}
