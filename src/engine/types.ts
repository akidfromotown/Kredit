// Shared domain types for the Kredit demo. Everything here is synthetic.

export type CustomerModel = "b2b" | "b2c";

export interface Industry {
  name: string;
  model: CustomerModel;
  /** Extra month-to-month revenue noise for the sector. */
  vol: number;
  /** Multiplicative seasonality by calendar month (index 0 = Jan). */
  season: number[];
  restricted?: boolean;
}

export type TxnCategory =
  | "sales"
  | "owner_contribution"
  | "payroll"
  | "rent"
  | "inventory"
  | "utilities"
  | "operating"
  | "loan_payment"
  | "owner_draw"
  | "tax"
  | "nsf_fee";

export interface Transaction {
  date: string;
  description: string;
  category: TxnCategory;
  /** Positive = credit, negative = debit. */
  amount: number;
  balance: number;
  counterparty: string;
  /** Debit attempted but returned unpaid for insufficient funds. */
  returned?: boolean;
}

export interface MonthSummary {
  month: string;
  /** "pre" = inside the 12-month underwriting window; "post" = after the application month. */
  phase: "pre" | "post";
  revenue: number;
  ownerContributions: number;
  operatingExpenses: number;
  debtPayments: number;
  nsfCount: number;
  endBalance: number;
  minBalance: number;
  avgBalance: number;
  negativeDays: number;
}

export interface Owner {
  name: string;
  ownershipPct: number;
  /** Mock bureau score. */
  creditScore: number;
}

export type KycStatus = "pass" | "refer" | "fail";

export interface KycCheck {
  id: string;
  group: "KYB" | "KYC";
  name: string;
  provider: string;
  status: KycStatus;
  detail: string;
}

export interface Application {
  id: string;
  appliedOn: string;
  appMonth: string;
  requestedAmount: number;
  requestedTermMonths: number;
  purpose: string;
  /** Applicant-stated annual revenue (may disagree with bank data). */
  statedAnnualRevenue: number;
}

export interface Business {
  id: string;
  name: string;
  dba?: string;
  industry: string;
  state: string;
  entityType: "LLC" | "S-Corp" | "C-Corp" | "Sole proprietor" | "Partnership";
  ein: string;
  monthsInBusiness: number;
  owner: Owner;
  application: Application;
  kyc: KycCheck[];
  months: MonthSummary[];
  /** Pre-application revenue by payer (invoiced customers / marketplaces; card settlements excluded). */
  payerTotals: Record<string, number>;
  /** Hidden simulation drivers. Never read by the attribute, policy, scorecard or decision engines. */
  hidden: SimProfile;
  /** Development-sample outcome: 60+ DPD within 12 months if funded as requested. Validation only. */
  outcomeBad12m: boolean;
  source: "synthetic" | "onboarded";
}

export interface SimProfile {
  /** Latent credit quality, ~N(0,1); higher = riskier. */
  risk: number;
  revenueBase: number;
  growth: number;
  vol: number;
  opexRatio: number;
  openingBalance: number;
  debt: { kind: "term" | "mca"; monthly: number; lender: string } | null;
  payers: { name: string; share: number }[];
  shockMonth?: string;
  shockSize: number;
  stackingMonth?: string;
  stackingMonthly: number;
}

export interface Attributes {
  monthsInBusiness: number;
  ownerCreditScore: number;
  avgMonthlyRevenue: number;
  revenueTrendPct: number;
  revenueVolatility: number;
  daysCashOnHand: number;
  nsfCount12m: number;
  nsfCount3m: number;
  existingDebtMonthly: number;
  debtServiceRatio: number;
  customerConcentration: number;
  netOperatingCashFlow: number;
  negativeBalanceDays: number;
  restrictedIndustry: number;
  statedRevenueVariancePct: number;
}

export type AttributeKey = keyof Attributes;
