// Plain-language definitions for credit-risk terms shown next to numbers and headings.
export const GLOSSARY = {
  approvalRate: "Share of decided applications that were approved, after any human review or override. Pending reviews are left out.",
  straightThrough: "Share of applications the rules and scorecard decided on their own, with no person involved.",
  outstanding: "Principal still owed on loans that are open (not paid off or charged off).",
  dpd: "Days past due: how late a borrower is on a scheduled payment.",
  dpd30: "Balance on loans more than 30 days late, as a share of all open balances. The standard early read on credit quality.",
  netLoss: "Expected charge-offs over the next 12 months on today's loans, minus expected recoveries. No new lending included.",
  chargeOff: "When a loan is written off as unlikely to be repaid, here at 120 days past due. Collection can continue afterwards.",
  vintage: "All loans funded in the same month. Comparing vintages at the same age shows whether newer lending performs better or worse.",
  mob: "Months on book: how long ago the loan was funded.",
  rollRate: "Share of balance that moves from one lateness bucket to another in a month, e.g. from 1–30 days late to 31–60.",
  score: "Points from the scorecard. Higher means lower expected risk. Each characteristic adds points; the total sets the band and the outcome.",
  band: "Risk grade from A (lowest risk) to E, set by the score. The band decides the loan limit and the interest rate.",
  knockout: "A hard policy rule. If any one fails, the application is declined before scoring, with that rule as the stated reason.",
  dscr: "Debt service coverage: monthly operating cash flow divided by all monthly debt payments. 1.25x means $1.25 of cash for every $1 owed.",
  affordability: "The new payment must leave enough cash flow (minimum DSCR) and stay under a share of monthly revenue.",
  nsf: "Non-sufficient funds: a payment bounced or overdrew the account. Frequent NSFs signal cash stress.",
  daysCash: "How many days the business could cover its usual outgoings from its average bank balance.",
  volatility: "How much monthly revenue swings around its average. 0.10 means a typical month is about 10% off the average.",
  concentration: "Share of revenue from the single largest customer. High reliance on one customer is a risk if they leave.",
  override: "A person reversed what the rules and scorecard decided. Always needs a written reason and is flagged in the audit log.",
  trigger: "An automatic warning on a funded loan, such as a revenue drop, bounced payments or new borrowing elsewhere.",
  auditChain: "Every log entry includes a fingerprint of the one before it, so any edit or deletion is detectable.",
  gini: "How well the score separates good from bad loans: 0 is random, 1 is perfect. 0.4–0.6 is typical for small-business scorecards.",
  ks: "Largest gap between the score distributions of good and bad loans, in percentage points. Higher separates better.",
} as const;

export type Term = keyof typeof GLOSSARY;
