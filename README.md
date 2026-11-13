# Kredit — credit risk demo

A demo credit risk system for a **fictional US small-business lender**. It shows how a fintech runs lending in-house end to end: onboarding, underwriting, decisioning, monitoring, collections and audit. **Synthetic data only. No real customers, no real lending.**

Built on the Steady stack and design system (Vite, React, TypeScript, Tailwind, Steady HSL tokens, Recharts). Everything runs in the browser. No backend is needed for the demo.

```sh
npm install
npm run dev            # local dev server
npm test               # engine tests (governance rules, guardrails, audit chain)
npm run build:single   # one self-contained HTML file in dist-single/
```

## Governance rules (enforced in code and tests)

- **Rules and the scorecard decide.** `src/engine/decision.ts` is the only code that produces an outcome. The AI assistant (`assistant.ts`) takes read-only data and returns text. Nothing in the decision path imports it (there is a test for this).
- **Every decision stores** its inputs (application + all attributes + KYC results), the policy version, every knockout result, the score and its line items, the offer calculation, the reasons, and any human review or override.
- **Every decline has specific stated reasons**: KYC check failed, knockout rule with the actual value and the requirement, or score below cutoff plus the top adverse factors. Analyst declines must pick at least one reason code and write a justification.
- KYC/KYB failures cannot be overridden to approve.
- The audit log is append-only and hash-chained. Editing any entry breaks the chain, and the Audit page verifies it.

## Modules

| # | Module | Where |
|---|---|---|
| 1 | Synthetic data: 500 businesses, 12 months of day-level bank transactions, loan outcomes | `engine/data.ts`, `engine/loanSim.ts`, Data & model page |
| 2 | Onboarding with mocked KYC/KYB and bank connection | `engine/kyc.ts`, New application page |
| 3 | Attribute engine | `engine/attributes.ts` |
| 4 | Policy engine with editable knockout rules | `engine/policy.ts`, Credit policy page |
| 5 | Scorecard: points, bands, cutoffs, validation (Gini/KS) | `engine/policy.ts`, `portfolio.ts#validateScorecard` |
| 6 | Limit & pricing grids with affordability cap (DSCR + % of revenue) | `engine/pricing.ts` |
| 7 | Decision flow: auto approve, decline, manual review queue, overrides | `engine/decision.ts`, Review queue |
| 8 | Monitoring: account triggers, vintage table, roll rates | `engine/portfolio.ts`, Monitoring page |
| 9 | Collections stages and roll-rate loss forecast | `engine/portfolio.ts`, Collections page |
| 10 | Portfolio dashboard | Portfolio page |
| 11 | AI assistant: document screen, credit memo, decline explanation, warning summary | `engine/assistant.ts` (deterministic templates in demo mode) |
| 12 | Audit log of every decision, review, override, policy change and AI output | `engine/audit.ts`, Audit page |

## How the demo world works

- The seeded world is rebuilt deterministically on every load: 500 applications decided under `POL-1.0`, plus synthetic analyst history for older reviews and a few documented overrides.
- What you do (publish policy versions, resolve reviews, override, onboard applicants, generate AI drafts) is stored as an action list in `localStorage` and replayed on top. "Reset demo" on the Audit page clears it.
- A hidden credit-quality driver shapes each business's bank data and its loan performance. The attribute, policy, scorecard and decision engines never read it. The 12-month development outcome is used only to validate the scorecard and back-test policy drafts.
- The loss forecast blends observed 6-month roll rates with a benchmark matrix by credibility weight, so a young book doesn't produce a zero forecast.

## Not production

The demo has no real KYC vendors, bureau or bank aggregator, and no real LLM. The audit hash is non-cryptographic, and there is no auth or server-side persistence. The natural next step is to move `src/engine` behind Supabase (tables + edge functions), as in Steady.
