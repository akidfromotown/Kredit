// Module 1: synthetic data. 500 fictional US small businesses, 12 months of bank transactions
// before their application, continued bank activity after it, and a development-sample loan outcome.
import { AS_OF_MONTH, addMonths, daysInMonth, isoDate, monthDiff, parseMonth, weekday } from "./dates";
import { runKycChecks, type KycScenario } from "./kyc";
import { simulateLoanPath, isBad60 } from "./loanSim";
import { Rng, clamp } from "./rng";
import type { Business, Industry, MonthSummary, SimProfile, Transaction, TxnCategory } from "./types";

const flat = Array(12).fill(1);
export const INDUSTRIES: Industry[] = [
  { name: "Restaurant", model: "b2c", vol: 0.06, season: [0.88, 0.9, 0.98, 1, 1.04, 1.08, 1.1, 1.08, 1, 0.98, 0.97, 1.02] },
  { name: "Retail store", model: "b2c", vol: 0.05, season: [0.82, 0.85, 0.95, 0.97, 1, 0.98, 0.97, 1, 0.97, 1, 1.15, 1.35] },
  { name: "Construction contractor", model: "b2b", vol: 0.12, season: [0.75, 0.78, 0.92, 1.05, 1.12, 1.15, 1.15, 1.12, 1.05, 1, 0.92, 0.8] },
  { name: "Trucking & logistics", model: "b2b", vol: 0.08, season: [0.94, 0.94, 1, 1, 1.02, 1.02, 1, 1.02, 1.02, 1.04, 1.04, 0.96] },
  { name: "Medical / dental practice", model: "b2b", vol: 0.04, season: flat },
  { name: "Professional services", model: "b2b", vol: 0.07, season: [1.02, 1, 1.05, 1.05, 1, 0.98, 0.92, 0.94, 1, 1.02, 1, 1.02] },
  { name: "Auto repair", model: "b2c", vol: 0.05, season: [0.95, 0.95, 1, 1.02, 1.02, 1.02, 1, 1, 1, 1.02, 1, 1.02] },
  { name: "Salon & spa", model: "b2c", vol: 0.05, season: [0.92, 0.95, 1, 1.02, 1.04, 1.02, 0.98, 0.98, 0.98, 1, 1.02, 1.1] },
  { name: "E-commerce seller", model: "b2b", vol: 0.1, season: [0.85, 0.82, 0.9, 0.92, 0.95, 0.95, 1, 0.98, 0.98, 1.05, 1.3, 1.45] },
  { name: "Wholesale distribution", model: "b2b", vol: 0.07, season: flat },
  { name: "Landscaping", model: "b2b", vol: 0.1, season: [0.55, 0.6, 0.9, 1.15, 1.3, 1.3, 1.25, 1.2, 1.1, 1, 0.8, 0.6] },
  { name: "Fitness studio", model: "b2c", vol: 0.05, season: [1.15, 1.08, 1.02, 1, 0.98, 0.95, 0.92, 0.92, 1, 1, 0.98, 0.95] },
  { name: "Cannabis dispensary", model: "b2c", vol: 0.06, season: flat, restricted: true },
  { name: "Check cashing / MSB", model: "b2c", vol: 0.05, season: flat, restricted: true },
];
const INDUSTRY_WEIGHTS: Record<string, number> = {
  Restaurant: 13, "Retail store": 11, "Construction contractor": 11, "Trucking & logistics": 9, "Medical / dental practice": 7,
  "Professional services": 9, "Auto repair": 7, "Salon & spa": 6, "E-commerce seller": 7, "Wholesale distribution": 6,
  Landscaping: 5, "Fitness studio": 4, "Cannabis dispensary": 1.5, "Check cashing / MSB": 1,
};
export const industryByName = (n: string) => INDUSTRIES.find((i) => i.name === n)!;

const NOUNS: Record<string, string[]> = {
  Restaurant: ["Kitchen", "Bistro", "Taqueria", "Grill", "Noodle House", "Bakery", "Diner"],
  "Retail store": ["Goods", "Outfitters", "Market", "Boutique", "Hardware", "Books"],
  "Construction contractor": ["Builders", "Construction", "Contracting", "Roofing", "Concrete"],
  "Trucking & logistics": ["Freight", "Logistics", "Transport", "Hauling"],
  "Medical / dental practice": ["Family Dental", "Pediatrics", "Physical Therapy", "Medical Group", "Chiropractic"],
  "Professional services": ["Consulting", "Accounting", "Design Studio", "Engineering", "Marketing"],
  "Auto repair": ["Auto Care", "Motors", "Collision", "Tire & Lube"],
  "Salon & spa": ["Salon", "Day Spa", "Barbershop", "Nail Studio"],
  "E-commerce seller": ["Supply Co", "Home Goods", "Apparel", "Pet Supply"],
  "Wholesale distribution": ["Distributors", "Wholesale", "Trading Co", "Supply"],
  Landscaping: ["Landscaping", "Lawn & Garden", "Tree Service", "Hardscapes"],
  "Fitness studio": ["Fitness", "Yoga", "CrossFit", "Pilates"],
  "Cannabis dispensary": ["Dispensary", "Wellness Collective"],
  "Check cashing / MSB": ["Check Cashing", "Money Services"],
};
const PREFIX = ["Harbor", "Summit", "Maple", "Copper", "Bluebird", "Ironwood", "Lakeside", "Redrock", "Cedar", "Prairie", "Silver Pine",
  "North Star", "Riverbend", "Oak Hollow", "Granite", "Sunrise", "Westfield", "Blue Ridge", "Coastal", "Highland", "Juniper", "Magnolia",
  "Pioneer", "Evergreen", "Willow", "Keystone", "Lone Oak", "Bayview", "Canyon", "Foxglove", "Brightwater", "Old Mill", "Twin Rivers",
  "Sagebrush", "Hearth", "Mesa", "Crescent", "Anchor", "Larkspur", "Union"];
const FIRST = ["Maria", "James", "Aisha", "Daniel", "Mei", "Carlos", "Priya", "Michael", "Fatima", "David", "Grace", "Luis", "Hannah",
  "Kwame", "Sofia", "Tom", "Nadia", "Jorge", "Emily", "Andre", "Linh", "Rachel", "Omar", "Laura", "Samuel", "Yuki", "Elena", "Marcus",
  "Ana", "Kevin", "Chloe", "Ibrahim", "Rosa", "Ethan", "Leila", "Victor"];
const LAST = ["Alvarez", "Nguyen", "Okafor", "Smith", "Patel", "Kim", "Johnson", "Garcia", "Chen", "Williams", "Haddad", "Brown",
  "Rossi", "Mensah", "Lopez", "Novak", "Hughes", "Tanaka", "Reyes", "Clarke", "Silva", "Singh", "Murphy", "Diaz", "Cohen", "Ward",
  "Ortiz", "Baker", "Hassan", "Price", "Ramos", "Foster", "Kowalski", "Bennett"];
const STATES: [string, number][] = [["CA", 12], ["TX", 10], ["FL", 8], ["NY", 7], ["IL", 5], ["PA", 4], ["OH", 4], ["GA", 4], ["NC", 4],
  ["MI", 3], ["NJ", 3], ["VA", 3], ["WA", 3], ["AZ", 3], ["MA", 3], ["TN", 2], ["CO", 2], ["MN", 2], ["MO", 2], ["OR", 2], ["NV", 2], ["UT", 1], ["WI", 2]];
const PURPOSES = ["Working capital", "Equipment purchase", "Inventory", "Expansion / new location", "Refinance existing debt", "Hiring"];
const LENDERS = ["Northbeam Capital", "Quickline Funding", "Prairie State Bank", "Ledgerwise Advance", "Cobalt Merchant Capital"];
const CUSTOMER_WORDS = ["Holdings", "Group", "Partners", "Industries", "Health Plan", "Properties", "Retail", "Foods", "Systems", "County", "Logistics"];
const MARKETPLACES = ["Marketplace A payout", "Marketplace B payout", "Storefront payout", "Wholesale portal"];

export const DATASET_SEED = "kredit-demo-v1";
export const DATASET_SIZE = 500;
export const STANDARD_LABEL_TERMS = { aprPct: 18, termMonths: 12 };

function payerList(rng: Rng, industry: Industry, risk: number): { name: string; share: number }[] {
  if (industry.model === "b2c") return [];
  if (industry.name === "E-commerce seller") {
    const top = clamp(0.45 + rng.range(0, 0.45), 0.4, 0.92);
    return [{ name: MARKETPLACES[0], share: top }, { name: MARKETPLACES[2], share: (1 - top) * 0.7 }, { name: MARKETPLACES[3], share: (1 - top) * 0.3 }];
  }
  const n = rng.int(4, 24);
  const top = clamp(0.06 + 0.6 * rng.next() ** 2 + 0.04 * risk, 0.05, 0.85);
  const rest: number[] = [];
  for (let i = 1; i < n; i++) rest.push(Math.pow(0.8, i) * rng.range(0.6, 1.4));
  const restSum = rest.reduce((a, b) => a + b, 0);
  const shares = [top, ...rest.map((r) => ((1 - top) * r) / restSum)];
  // keep the designated top payer the largest
  for (let i = 1; i < shares.length; i++) shares[i] = Math.min(shares[i], top * 0.95);
  const norm = shares.reduce((a, b) => a + b, 0);
  return shares.map((s) => ({ name: `${rng.pick(PREFIX)} ${rng.pick(CUSTOMER_WORDS)}`, share: s / norm }));
}

export interface ProfileOverrides {
  risk?: number;
  revenueBase?: number;
}

export function makeProfile(rng: Rng, industry: Industry, appMonth: string, o: ProfileOverrides = {}): SimProfile {
  const risk = o.risk ?? rng.normal();
  const revenueBase = o.revenueBase ?? clamp(Math.exp(rng.normal(Math.log(52000), 0.85)), 9000, 1_400_000);
  const shockP = clamp(0.06 + 0.07 * risk, 0.02, 0.3);
  const shock = rng.chance(shockP);
  const stack = rng.chance(clamp(0.05 + 0.05 * risk, 0.01, 0.2));
  const hasDebt = rng.chance(clamp(0.42 + 0.12 * risk, 0.15, 0.8));
  return {
    risk,
    revenueBase,
    growth: 0.004 - 0.011 * risk + rng.normal(0, 0.01),
    vol: clamp(0.05 + 0.05 * Math.max(risk, 0) + Math.abs(rng.normal(0, 0.06)) + industry.vol, 0.03, 0.6),
    opexRatio: clamp(0.83 + 0.06 * risk + rng.normal(0, 0.045), 0.62, 1.06),
    openingBalance: revenueBase * clamp(Math.exp(rng.normal(-0.7 - 0.55 * risk, 0.65)), 0.03, 3.5),
    debt: hasDebt
      ? { kind: rng.chance(0.35 + 0.15 * Math.max(risk, 0)) ? "mca" : "term", monthly: revenueBase * rng.range(0.02, 0.09) * (1 + 0.4 * Math.max(risk, 0)), lender: rng.pick(LENDERS) }
      : null,
    payers: payerList(rng, industry, risk),
    shockMonth: shock ? addMonths(appMonth, rng.int(1, 12)) : undefined,
    shockSize: shock ? rng.range(0.25, 0.6) : 0,
    stackingMonth: stack ? addMonths(appMonth, rng.int(1, 10)) : undefined,
    stackingMonthly: revenueBase * rng.range(0.05, 0.12),
  };
}

const NSF_FEE = 35;

export interface SimResult {
  months: MonthSummary[];
  payerTotals: Record<string, number>;
  transactions: Transaction[];
}

/**
 * Day-by-day bank account simulation from 12 months before the application month through AS_OF_MONTH.
 * With record=false only monthly summaries are kept (fast path used for all 500 businesses).
 */
export function simulateAccount(id: string, industry: Industry, appMonth: string, p: SimProfile, record = false): SimResult {
  const rng = new Rng(id + ":bank");
  const start = addMonths(appMonth, -12);
  const total = monthDiff(start, AS_OF_MONTH) + 1;
  const months: MonthSummary[] = [];
  const payerTotals: Record<string, number> = {};
  const txns: Transaction[] = [];
  let bal = p.openingBalance;
  const processor = rng.pick(["CardPay settlement", "SwiftPOS settlement", "Tillwise settlement"]);
  const payroll = rng.pick(["PayFlow payroll", "Crewly payroll"]);
  const landlord = `${rng.pick(PREFIX)} Properties`;
  const supplier = `${rng.pick(PREFIX)} Supply Co`;

  for (let i = 0; i < total; i++) {
    const month = addMonths(start, i);
    const [, cal] = parseMonth(month);
    const phase: "pre" | "post" = monthDiff(month, appMonth) > 0 ? "pre" : "post";
    const baseline = p.revenueBase * Math.pow(1 + p.growth, i) * industry.season[cal - 1];
    const shocked = p.shockMonth && monthDiff(p.shockMonth, month) >= 0 ? 1 - p.shockSize : 1;
    const revenue = baseline * Math.exp(rng.normal(-p.vol * p.vol / 2, p.vol)) * shocked;
    const opex = p.opexRatio * (0.55 * p.revenueBase * Math.pow(1 + p.growth, i) + 0.45 * revenue);
    const dim = daysInMonth(month);
    const stacked = p.stackingMonth && monthDiff(p.stackingMonth, month) >= 0;

    const s: MonthSummary = { month, phase, revenue: 0, ownerContributions: 0, operatingExpenses: 0, debtPayments: 0, nsfCount: 0, endBalance: 0, minBalance: Infinity, avgBalance: 0, negativeDays: 0 };

    // deposit schedule
    const depositDays: number[] = [];
    for (let d = 1; d <= dim; d++) {
      const wd = weekday(month, d);
      if (wd === 0 || wd === 6) continue;
      if (industry.model === "b2c" ? wd === 1 || wd === 3 || wd === 5 : rng.chance(0.35)) depositDays.push(d);
    }
    if (depositDays.length === 0) depositDays.push(15);
    const weights = depositDays.map(() => rng.range(0.6, 1.4));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const businessDays = Array.from({ length: dim }, (_, k) => k + 1).filter((d) => { const w = weekday(month, d); return w !== 0 && w !== 6; });
    let fridays = 0;

    const post = (date: string, description: string, category: TxnCategory, amount: number, counterparty: string, returned = false) => {
      if (record) txns.push({ date, description, category, amount: Math.round(amount * 100) / 100, balance: Math.round(bal * 100) / 100, counterparty, returned });
    };
    const credit = (d: number, amt: number, cat: TxnCategory, cp: string, desc: string) => {
      bal += amt;
      if (cat === "sales") s.revenue += amt; else s.ownerContributions += amt;
      post(isoDate(month, d), desc, cat, amt, cp);
    };
    const debit = (d: number, amt: number, cat: TxnCategory, cp: string, desc: string) => {
      if (amt <= 0) return;
      if (bal < amt && cat !== "payroll" && rng.chance(0.75)) {
        s.nsfCount++;
        post(isoDate(month, d), `${desc} (returned NSF)`, cat, -amt, cp, true);
        bal -= NSF_FEE;
        post(isoDate(month, d), "NSF returned item fee", "nsf_fee", -NSF_FEE, "Bank");
        return;
      }
      if (bal < amt) {
        s.nsfCount++;
        bal -= NSF_FEE;
        post(isoDate(month, d), "Overdraft fee", "nsf_fee", -NSF_FEE, "Bank");
      }
      bal -= amt;
      if (cat === "loan_payment") s.debtPayments += amt;
      else if (cat !== "owner_draw") s.operatingExpenses += amt;
      post(isoDate(month, d), desc, cat, -amt, cp);
    };

    let balSum = 0;
    for (let d = 1; d <= dim; d++) {
      const wd = weekday(month, d);
      const di = depositDays.indexOf(d);
      if (di >= 0) {
        const amt = (revenue * weights[di]) / wsum;
        if (p.payers.length) {
          let r = rng.next();
          let payer = p.payers[0];
          for (const py of p.payers) { r -= py.share; if (r <= 0) { payer = py; break; } }
          credit(d, amt, "sales", payer.name, `ACH credit ${payer.name}`);
          if (phase === "pre") payerTotals[payer.name] = (payerTotals[payer.name] ?? 0) + amt;
        } else {
          credit(d, amt, "sales", processor, `${processor} batch`);
        }
      }
      if (d === 1) debit(d, 0.1 * opex, "rent", landlord, "Rent");
      if (wd === 5 && ++fridays % 2 === 0) debit(d, 0.36 * opex / 2, "payroll", payroll, "Payroll");
      if (wd === 2) debit(d, (0.34 * opex) / 4.33, "inventory", supplier, "Supplies & inventory");
      if (d === 10) debit(d, 0.04 * opex, "utilities", "City Utilities", "Utilities");
      if (d === 5 || d === 12 || d === 19 || d === 26) debit(d, (0.13 * opex) / 4, "operating", "Business card", "Card payment / insurance / software");
      if (d === 15 && [1, 4, 6, 9].includes(cal)) debit(d, 0.03 * opex * 3, "tax", "US Treasury", "Estimated tax payment");
      if (p.debt) {
        if (p.debt.kind === "term" && d === 15) debit(d, p.debt.monthly, "loan_payment", p.debt.lender, `${p.debt.lender} loan payment`);
        if (p.debt.kind === "mca" && businessDays.includes(d)) debit(d, p.debt.monthly / businessDays.length, "loan_payment", p.debt.lender, `${p.debt.lender} daily remittance`);
      }
      if (stacked && businessDays.includes(d)) debit(d, p.stackingMonthly / businessDays.length, "loan_payment", "Velo Advance", "Velo Advance daily remittance");
      if (d === 28 && bal > 1.6 * opex) debit(d, 0.4 * (bal - 1.6 * opex), "owner_draw", "Owner", "Owner distribution");
      if (d === dim && bal < -1000 && rng.chance(0.65)) credit(d, -bal + 0.15 * opex, "owner_contribution", "Owner", "Owner capital contribution");
      balSum += bal;
      s.minBalance = Math.min(s.minBalance, bal);
      if (bal < 0) s.negativeDays++;
    }
    s.endBalance = bal;
    s.avgBalance = balSum / dim;
    months.push(s);
  }
  return { months, payerTotals, transactions: txns };
}

function businessName(rng: Rng, industry: Industry, used: Set<string>): string {
  for (let k = 0; k < 20; k++) {
    const n = `${rng.pick(PREFIX)} ${rng.pick(NOUNS[industry.name])}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = `${rng.pick(PREFIX)} ${rng.pick(NOUNS[industry.name])} ${used.size}`;
  used.add(n);
  return n;
}

export function preRevenue(months: MonthSummary[]): number {
  return months.filter((m) => m.phase === "pre").reduce((a, m) => a + m.revenue, 0);
}

function labelOutcome(id: string, p: SimProfile, months: MonthSummary[], requested: number, appMonth: string): boolean {
  const path = simulateLoanPath({
    seed: id + ":label", risk: p.risk, principal: requested, ...STANDARD_LABEL_TERMS,
    originationMonth: appMonth, throughMonth: addMonths(appMonth, 12), avgMonthlyRevenue: preRevenue(months) / 12,
    shockMonth: p.shockMonth, shockSize: p.shockSize, stackingMonth: p.stackingMonth,
  });
  return path.some((m) => isBad60(m.bucket));
}

export interface NewBusinessInput {
  id: string;
  name: string;
  industry: string;
  state: string;
  entityType: Business["entityType"];
  monthsInBusiness: number;
  ownerName: string;
  ownerCreditScore: number;
  requestedAmount: number;
  requestedTermMonths: number;
  purpose: string;
  statedAnnualRevenue: number;
  appliedOn: string;
  /** Drives the synthetic bank data the mock "bank connection" returns. */
  bankProfile: "strong" | "average" | "weak";
  kycScenario: KycScenario;
}

export function buildBusiness(inp: NewBusinessInput): Business {
  const rng = new Rng(inp.id);
  const industry = industryByName(inp.industry);
  const appMonth = inp.appliedOn.slice(0, 7);
  const risk = { strong: -1.3, average: 0, weak: 1.4 }[inp.bankProfile];
  const profile = makeProfile(rng, industry, appMonth, { risk, revenueBase: Math.max(inp.statedAnnualRevenue / 12, 5000) * rng.range(0.85, 1.05) });
  const sim = simulateAccount(inp.id, industry, appMonth, profile);
  return {
    id: inp.id,
    name: inp.name,
    industry: inp.industry,
    state: inp.state,
    entityType: inp.entityType,
    ein: `${rng.int(10, 99)}-${rng.int(1000000, 9999999)}`,
    monthsInBusiness: inp.monthsInBusiness,
    owner: { name: inp.ownerName, ownershipPct: 100, creditScore: inp.ownerCreditScore },
    application: {
      id: `APP-${inp.id.slice(-5)}`, appliedOn: inp.appliedOn, appMonth, requestedAmount: inp.requestedAmount,
      requestedTermMonths: inp.requestedTermMonths, purpose: inp.purpose, statedAnnualRevenue: inp.statedAnnualRevenue,
    },
    kyc: runKycChecks(inp.id, inp.kycScenario),
    months: sim.months,
    payerTotals: sim.payerTotals,
    hidden: profile,
    outcomeBad12m: labelOutcome(inp.id, profile, sim.months, inp.requestedAmount, appMonth),
    source: "onboarded",
  };
}

export function generatePortfolio(n = DATASET_SIZE, seed = DATASET_SEED): Business[] {
  const used = new Set<string>();
  const out: Business[] = [];
  const firstAppMonth = addMonths(AS_OF_MONTH, -11);
  for (let i = 0; i < n; i++) {
    const id = `BIZ-${String(10001 + i)}`;
    const brng = new Rng(`${seed}:${id}`);
    const industry = industryByName(brng.weighted(Object.entries(INDUSTRY_WEIGHTS)));
    // applications spread evenly over the 12 months ending at AS_OF
    const appMonth = addMonths(firstAppMonth, Math.floor((i / n) * 12 + brng.next() * 0.999) % 12);
    const day = brng.int(1, Math.min(28, daysInMonth(appMonth)));
    const profile = makeProfile(brng, industry, appMonth);
    const sim = simulateAccount(id, industry, appMonth, profile);
    const actualAnnual = preRevenue(sim.months);
    const overstate = brng.chance(0.1);
    const stated = Math.round((actualAnnual * (overstate ? brng.range(1.25, 1.7) : 1 + brng.normal(0, 0.04))) / 1000) * 1000;
    const requested = clamp(Math.round((profile.revenueBase * brng.range(0.4, 2.2)) / 5000) * 5000, 10000, 500000);
    const term = brng.weighted([[6, 1], [12, 3], [18, 2], [24, 2]] as const);
    const monthsInBusiness = clamp(Math.round(Math.exp(brng.normal(3.7 - 0.3 * profile.risk, 0.85))), 4, 420);
    const owner = `${brng.pick(FIRST)} ${brng.pick(LAST)}`;
    out.push({
      id,
      name: `${businessName(brng, industry, used)} ${brng.weighted([["LLC", 6], ["Inc", 3], ["", 1]] as const)}`.trim(),
      industry: industry.name,
      state: brng.weighted(STATES),
      entityType: brng.weighted([["LLC", 55], ["S-Corp", 22], ["C-Corp", 8], ["Sole proprietor", 10], ["Partnership", 5]] as const),
      ein: `${brng.int(10, 99)}-${brng.int(1000000, 9999999)}`,
      monthsInBusiness,
      owner: { name: owner, ownershipPct: brng.weighted([[100, 6], [75, 2], [51, 2]] as const), creditScore: Math.round(clamp(705 - 48 * profile.risk + brng.normal(0, 38), 520, 840)) },
      application: {
        id: `APP-${String(20001 + i)}`, appliedOn: isoDate(appMonth, day), appMonth, requestedAmount: requested,
        requestedTermMonths: term, purpose: brng.pick(PURPOSES), statedAnnualRevenue: stated,
      },
      kyc: runKycChecks(id),
      months: sim.months,
      payerTotals: sim.payerTotals,
      hidden: profile,
      outcomeBad12m: labelOutcome(id, profile, sim.months, requested, appMonth),
      source: "synthetic",
    });
  }
  return out;
}
