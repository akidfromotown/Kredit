// Monthly loan performance simulation for booked (and development-sample) loans.
import { addMonths, monthDiff } from "./dates";
import { Rng, clamp, logistic } from "./rng";

export const BUCKETS = ["current", "dpd1_30", "dpd31_60", "dpd61_90", "dpd90p", "chargedoff", "paidoff"] as const;
export type Bucket = (typeof BUCKETS)[number];

export const BUCKET_LABEL: Record<Bucket, string> = {
  current: "Current",
  dpd1_30: "1–30 DPD",
  dpd31_60: "31–60 DPD",
  dpd61_90: "61–90 DPD",
  dpd90p: "90+ DPD",
  chargedoff: "Charged off",
  paidoff: "Paid off",
};

/** Missed-payment count for each delinquency bucket. */
const MISSED: Record<Bucket, number> = { current: 0, dpd1_30: 1, dpd31_60: 2, dpd61_90: 3, dpd90p: 4, chargedoff: 0, paidoff: 0 };
const BY_MISSED: Bucket[] = ["current", "dpd1_30", "dpd31_60", "dpd61_90", "dpd90p"];

export interface LoanMonth {
  month: string;
  mob: number;
  bucket: Bucket;
  balance: number;
  paymentReceived: number;
  chargeOff: number;
}

export function amortPayment(principal: number, aprPct: number, termMonths: number): number {
  const r = aprPct / 100 / 12;
  if (r === 0) return principal / termMonths;
  return (principal * r) / (1 - Math.pow(1 + r, -termMonths));
}

export function balanceAfter(principal: number, aprPct: number, termMonths: number, paymentsMade: number): number {
  const r = aprPct / 100 / 12;
  const pmt = amortPayment(principal, aprPct, termMonths);
  if (paymentsMade >= termMonths) return 0;
  if (r === 0) return principal - pmt * paymentsMade;
  return principal * Math.pow(1 + r, paymentsMade) - (pmt * (Math.pow(1 + r, paymentsMade) - 1)) / r;
}

export interface LoanSimInput {
  seed: string;
  risk: number;
  principal: number;
  aprPct: number;
  termMonths: number;
  originationMonth: string;
  throughMonth: string;
  avgMonthlyRevenue: number;
  shockMonth?: string;
  shockSize: number;
  stackingMonth?: string;
}

export function simulateLoanPath(inp: LoanSimInput): LoanMonth[] {
  const rng = new Rng(inp.seed);
  const pmt = amortPayment(inp.principal, inp.aprPct, inp.termMonths);
  const burden = pmt / Math.max(inp.avgMonthlyRevenue, 1);
  const out: LoanMonth[] = [];
  let paymentsMade = 0;
  let bucket: Bucket = "current";
  const months = monthDiff(inp.originationMonth, inp.throughMonth);

  for (let mob = 1; mob <= months; mob++) {
    const month = addMonths(inp.originationMonth, mob);
    if (bucket === "chargedoff" || bucket === "paidoff") break;
    const shock = inp.shockMonth && monthDiff(inp.shockMonth, month) >= 0 ? inp.shockSize / 0.45 : 0;
    const stacked = inp.stackingMonth && monthDiff(inp.stackingMonth, month) >= 0 ? 1 : 0;
    const stress = 0.95 * inp.risk + 7 * Math.max(0, burden - 0.04) + 1.7 * shock + 0.8 * stacked;
    let paymentReceived = 0;
    let chargeOff = 0;
    const missed: number = MISSED[bucket];

    if (bucket === "current") {
      if (rng.chance(clamp(logistic(-4.45 + stress), 0.002, 0.6))) {
        bucket = "dpd1_30";
      } else if (rng.chance(0.008) && mob > 3) {
        paymentReceived = balanceAfter(inp.principal, inp.aprPct, inp.termMonths, paymentsMade);
        paymentsMade = inp.termMonths;
        bucket = "paidoff";
      } else {
        paymentsMade++;
        paymentReceived = pmt;
      }
    } else if (bucket === "dpd90p") {
      chargeOff = balanceAfter(inp.principal, inp.aprPct, inp.termMonths, paymentsMade);
      bucket = "chargedoff";
    } else {
      const cure = logistic([0, -0.3, -1.9, -2.6][missed] - 0.45 * stress + 0.6);
      const stay = [0, 0, 0.12, 0.08][missed];
      const r = rng.next();
      if (r < cure) {
        paymentsMade += missed + 1;
        paymentReceived = pmt * (missed + 1);
        bucket = "current";
      } else if (r < cure + stay) {
        // partial payment keeps the account in the same bucket
        paymentReceived = pmt * 0.5;
      } else {
        bucket = BY_MISSED[missed + 1];
      }
    }

    if (bucket === "current" && paymentsMade >= inp.termMonths) bucket = "paidoff";
    const balance = bucket === "chargedoff" || bucket === "paidoff" ? 0 : Math.max(0, balanceAfter(inp.principal, inp.aprPct, inp.termMonths, paymentsMade));
    out.push({ month, mob, bucket, balance, paymentReceived, chargeOff });
  }
  return out;
}

export const isBad60 = (b: Bucket) => b === "dpd61_90" || b === "dpd90p" || b === "chargedoff";
/** 30+ days past due, including charged off. */
export const is30Plus = (b: Bucket) => b === "dpd31_60" || isBad60(b);
export const isDelinquent = (b: Bucket) => b !== "current" && b !== "paidoff" && b !== "chargedoff";
