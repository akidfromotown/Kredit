# Kredit — credit risk demo

A demo credit risk system for a **fictional US small-business lender**. It shows how a fintech runs lending in-house end to end: onboarding, underwriting, decisioning, monitoring, collections and audit. **Synthetic data only. No real customers, no real lending.**

Built with Vite, React, TypeScript, Tailwind and Recharts, with an optional Supabase backend.

```sh
npm install
npm run dev            # local dev server
npm test               # engine tests (governance rules, guardrails, audit chain)
npm run test:db        # schema + server tests against a local Postgres (see below)
npm run build:single   # one self-contained HTML file in dist-single/
```

## Two modes

- **Local demo** (no configuration): the 500-business book is generated in the browser and your actions are saved in that browser only.
- **Backend** (`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` set): data lives in Supabase and everyone sees the same decisions and audit log. The browser can only read. Every write goes to the `kredit-api` Edge Function, which runs the decision engine server-side and validates every action. The header shows **Live database** or **Local demo**.

### Backend architecture

| Piece | Where | What it does |
|---|---|---|
| Schema | `supabase/migrations/` | `policies`, `businesses`, `decisions`, `audit_log`. RLS: public read, no direct writes. |
| Audit chain | database triggers | SHA-256 hash chain computed by Postgres on insert. Updates, deletes and truncates are rejected, even for the service role. `kredit_verify_audit()` re-checks the whole chain. |
| Decision immutability | database trigger | Engine fields can never change; one human action (review or override) can be added, once. Declines without reasons are rejected by check constraints. |
| Write functions | `kredit_record_application`, `kredit_record_human`, `kredit_publish_policy`, `kredit_append_audit` | Atomic writes (record + audit entries in one transaction). Executable by the service role only. |
| API | `supabase/functions/kredit-api` | Onboard, review/override, publish policy, AI drafts. Server assigns IDs, timestamps, policy versions and offer terms; never trusts them from the browser. |
| Shared logic | `src/engine`, `src/server` | Same engine and validation in browser, server and seed script. `npm run build:server` bundles it for Deno into `supabase/functions/_shared/kredit-server.js`. |

### Deploying to Supabase

1. Create a Supabase project. From **Project Settings → API** note the project URL, the publishable key (`sb_publishable_…`) and the secret / service role key.
2. Link and push the schema, then deploy the function:
   ```sh
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   npm run build:server
   npx supabase functions deploy kredit-api
   ```
3. Seed the demo book (wipes and reloads the demo tables):
   ```sh
   SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co SUPABASE_SERVICE_ROLE_KEY=... npm run seed
   ```
4. Copy `.env.example` to `.env.local`, fill in the URL and publishable key, and run `npm run dev`.

Never put the service role key in `.env.local` or anywhere the browser can see it.

### Testing the database locally

`npm run test:db` expects Postgres at `postgres://kredit_tester:kredit@localhost:5432/kredit_test` with the Supabase roles (`anon`, `authenticated`, `service_role`) and the migration applied. It seeds the full book and checks permissions, the append-only log, tamper detection and every server rule.

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
| — | Financial crime: sanctions / PEP / adverse-media screening, transaction monitoring, alert queue with dispositions | `engine/fincrime.ts`, Financial crime page |

## Financial crime and screening connectors

Screening runs through a `ScreeningProvider` interface in `src/engine/fincrime.ts`. A provider takes subjects (the business and its owner) and returns hits with list, match score, category, headline, source and date. Today only a deterministic demo provider, with fictional hits and outlets, is connected. A real adverse-media, sanctions or PEP vendor plugs in by implementing the same interface server-side, in the `kredit-api` function with its key stored as a Supabase secret, so credentials never reach the browser.

Transaction monitoring rules (deposit spikes, large owner injections, funds passing through) run on the bank data. Analysts clear, escalate or refer each alert with a required note. Dispositions are stored only as `FINCRIME_DISPOSITION` audit entries, so alert status is rebuilt from the tamper-evident log. Alerts never change a credit decision.

## How the demo world works

- The seeded world is rebuilt deterministically on every load: 500 applications decided under `POL-1.0`, plus synthetic analyst history for older reviews and a few documented overrides.
- What you do (publish policy versions, resolve reviews, override, onboard applicants, generate AI drafts) is stored as an action list in `localStorage` and replayed on top. "Reset demo" on the Audit page clears it.
- A hidden credit-quality driver shapes each business's bank data and its loan performance. The attribute, policy, scorecard and decision engines never read it. The 12-month development outcome is used only to validate the scorecard and back-test policy drafts.
- The loss forecast blends observed 6-month roll rates with a benchmark matrix by credibility weight, so a young book doesn't produce a zero forecast.

## Not production

The demo has no real KYC vendors, bureau or bank aggregator, and no real LLM. In local mode the audit hash is a fast non-cryptographic demo hash; in backend mode it is SHA-256 in Postgres. There is no user login yet: every write is attributed to a single demo credit officer, so adding Supabase Auth and role-based permissions (analyst, senior analyst, policy committee) is the next step.
