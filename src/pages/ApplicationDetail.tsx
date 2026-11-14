// Application detail: inputs, KYC/KYB, knockouts, score, offer, bank data, AI assistant, human actions, audit trail.
import { useMemo, useState } from "react";
import { ArrowLeft, Bot, ShieldAlert } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { ATTRIBUTE_META, attrMeta, formatAttr } from "../engine/attributes";
import { AI_TASK_LABEL, draftCreditMemo, explainDecline, screenDocuments, type AiOutput, type AiTask } from "../engine/assistant";
import { industryByName, simulateAccount } from "../engine/data";
import { monthLabel } from "../engine/dates";
import { HUMAN_DECLINE_REASONS, bookedTerms, constraintLabel, finalStatus, type Decision, type Reason } from "../engine/decision";
import { ScoreGauge } from "../components/ScoreGauge";
import type { Term } from "../components/glossary";
import type { CreditPolicy } from "../engine/policy";
import type { Business, TxnCategory } from "../engine/types";
import {
  Button, Card, CardHead, Empty, Field, InfoTip, Pill, RichText, StatusPill, TableWrap, Tabs, chartColors, cn, d8, dt, tooltipStyle, usd,
} from "../components/ui";
import { AuditList } from "./Audit";

type Tab = "decision" | "bank" | "kyc" | "assistant" | "audit";

export default function ApplicationDetail({ id }: { id: string }) {
  const { world } = useStore();
  const b = world.businesses.find((x) => x.id === id);
  const d = world.decisions[id];
  const [tab, setTab] = useState<Tab>("decision");
  if (!b || !d) return <Empty>Application not found.</Empty>;
  const policy = world.policies.find((p) => p.version === d.policyVersion)!;

  return (
    <div>
      <a href="#applications" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3"><ArrowLeft className="h-4 w-4" />Applications</a>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">{b.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {b.industry} · {b.entityType} · {b.state} · {Math.round(b.monthsInBusiness / 12)} years in business · owner {b.owner.name}
        </p>
      </div>
      <Verdict b={b} d={d} policy={policy} />
      <div className="h-4" />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: "decision", label: "Decision" }, { id: "bank", label: "Bank data" }, { id: "kyc", label: "KYC / KYB" },
        { id: "assistant", label: "AI assistant" }, { id: "audit", label: "Audit trail" },
      ]} />
      <div className="mt-4">
        {tab === "decision" && <DecisionTab b={b} d={d} policy={policy} />}
        {tab === "bank" && <BankTab b={b} />}
        {tab === "kyc" && <KycTab b={b} />}
        {tab === "assistant" && <AssistantTab b={b} d={d} />}
        {tab === "audit" && <AuditList filter={(e) => e.ref === d.id || e.ref === b.application.id || (e.payload as { businessId?: string })?.businessId === b.id} />}
      </div>
    </div>
  );
}

function Verdict({ b, d, policy }: { b: Business; d: Decision; policy: CreditPolicy }) {
  const status = finalStatus(d);
  const terms = bookedTerms(d);
  const app = d.inputs.application;
  const tone = status === "APPROVED" ? "gain" : status === "DECLINED" ? "loss" : "warn";
  let headline: string;
  let detail: string[];
  if (status === "APPROVED" && terms) {
    headline = `Approved for ${usd(terms.amount)}`;
    detail = [`${terms.aprPct}% APR over ${terms.termMonths} months, ${usd(terms.monthlyPayment)} a month.`];
    if (terms.amount < app.requestedAmount) detail.push(`Less than the ${usd(app.requestedAmount)} requested: limited by ${constraintLabel(terms.bindingConstraint)}.`);
  } else if (status === "DECLINED") {
    headline = "Declined";
    const rs = d.human?.action === "DECLINE" ? d.human.reasons : d.reasons;
    detail = rs.filter((r) => r.code !== "SC-CUTOFF").slice(0, 3).map((r) => r.text);
    if (d.reasons[0]?.code === "SC-CUTOFF" && !d.human) detail.unshift(`Score ${d.score} is below the decline cutoff of ${policy.scorecard.declineCutoff}. Weakest areas:`);
  } else {
    headline = "Waiting for an analyst";
    detail = d.reasons.filter((r) => r.stage === "review").map((r) => r.text);
  }
  const who = d.human
    ? d.human.kind === "override"
      ? `Overridden by ${d.human.by} on ${d8(d.human.at)}. The engine said ${d.engineOutcome.toLowerCase()}.`
      : `Reviewed by ${d.human.by} on ${d8(d.human.at)}.`
    : status === "PENDING_REVIEW" ? "The engine routed this file to a person." : `Decided automatically on ${d8(d.decidedAt)}.`;
  const offer = terms ?? d.offer;
  return (
    <Card className="p-5">
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("h-2.5 w-2.5 rounded-full", tone === "gain" && "bg-gain", tone === "loss" && "bg-loss", tone === "warn" && "bg-warn")} />
            <span className={cn("micro", tone === "gain" && "text-gain", tone === "loss" && "text-loss", tone === "warn" && "text-warn")}>{status === "PENDING_REVIEW" ? "Pending review" : status.toLowerCase()}</span>
            {d.human?.kind === "override" && <Pill tone="outline">override</Pill>}
          </div>
          <div className="num text-[32px] leading-tight mt-2">{headline}</div>
          <ul className="mt-2 space-y-1 text-sm">
            {detail.map((t, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{t}</span></li>)}
          </ul>
          <p className="text-xs text-muted-foreground mt-3">{who} Policy {d.policyVersion} · {d.id}</p>
        </div>
        <div className="min-w-0">
          <div className="micro flex items-center">Score {d.score} · band {d.band}<InfoTip term="score" align="left" /></div>
          <ScoreGauge score={d.score} sc={policy.scorecard} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Fact k="Requested" v={usd(app.requestedAmount, true)} />
            <Fact k="Offer" v={offer?.amount ? usd(offer.amount, true) : "None"} />
            <Fact k="Monthly payment" v={offer?.amount ? usd(offer.monthlyPayment) : "—"} />
            <Fact k="Cash coverage" term="dscr" v={offer?.amount ? `${offer.dscrAfter.toFixed(2)}x` : "—"} />
          </div>
        </div>
      </div>
    </Card>
  );
}

const Fact = ({ k, v, term }: { k: string; v: string; term?: Term }) => (
  <div className="rounded-xl border border-[hsl(var(--glass-line))] px-3 py-2">
    <div className="text-[10px] text-muted-foreground flex items-center">{k}{term && <InfoTip term={term} align="right" />}</div>
    <div className="num text-lg mt-0.5">{v}</div>
  </div>
);

function ReasonList({ reasons }: { reasons: Reason[] }) {
  return (
    <ul className="space-y-1.5">
      {reasons.map((r, i) => (
        <li key={i} className="flex gap-2 text-sm"><Pill tone="outline" className="shrink-0 font-mono">{r.code}</Pill><span>{r.text}</span></li>
      ))}
    </ul>
  );
}

function DecisionTab({ b, d, policy }: { b: Business; d: Decision; policy: CreditPolicy }) {
  const a = d.inputs.attributes;
  const o = d.offer;
  const sc = policy.scorecard;
  return (
    <div className="grid xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardHead title="Outcome and reasons" sub={`Decided ${dt(d.decidedAt)} UTC by the decision engine under ${d.policyVersion} · ${d.id}`} />
          <div className="px-5 pb-5 space-y-4">
            <ReasonList reasons={d.reasons} />
            {d.human && (
              <div className="rounded-2xl border p-3 space-y-2">
                <div className="text-sm"><span className="font-medium">{d.human.kind === "override" ? "Human override" : "Manual review"}:</span> {d.human.action} by {d.human.by} on {dt(d.human.at)} UTC</div>
                <div className="text-sm text-muted-foreground">“{d.human.note}”</div>
                {d.human.reasons.length > 0 && <ReasonList reasons={d.human.reasons} />}
                {d.human.offer && <div className="text-sm">Booked terms: {usd(d.human.offer.amount)} · {d.human.offer.aprPct}% APR · {d.human.offer.termMonths} mo · {usd(d.human.offer.monthlyPayment)}/mo</div>}
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Knockout rules" sub="Any rule that fails declines the application before scoring" term="knockout" />
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Rule</th><th>Attribute</th><th className="text-right">Value</th><th>Fails when</th><th>Result</th></tr></thead>
              <tbody>
                {d.knockouts.map((k) => {
                  const key = k.attribute as keyof typeof a;
                  return (
                    <tr key={k.ruleId}>
                      <td className="font-mono text-xs">{k.ruleId}</td>
                      <td>{attrMeta(key).label}</td>
                      <td className="text-right">{formatAttr(key, k.value)}</td>
                      <td className="text-muted-foreground">{k.operator} {formatAttr(key, k.threshold)}</td>
                      <td>{k.hit ? <Pill tone="loss">Hit</Pill> : <Pill tone="gain">Pass</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card>
          <CardHead title="Scorecard" sub={`Base ${sc.basePoints} points · approve ≥ ${sc.approveCutoff} · review ${sc.declineCutoff}–${sc.approveCutoff - 1} · decline < ${sc.declineCutoff}`} />
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Characteristic</th><th className="text-right">Value</th><th>Bin</th><th className="text-right">Points</th><th className="w-40"></th></tr></thead>
              <tbody>
                {d.scoreLines.map((l) => (
                  <tr key={l.attribute}>
                    <td>{attrMeta(l.attribute).label}</td>
                    <td className="text-right">{formatAttr(l.attribute, l.value)}</td>
                    <td className="text-muted-foreground">{l.bin}</td>
                    <td className="text-right font-medium">{l.points} / {l.maxPoints}</td>
                    <td><div className="h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${(l.points / l.maxPoints) * 100}%` }} /></div></td>
                  </tr>
                ))}
                <tr className="font-semibold"><td>Total</td><td /><td>Band {d.band}</td><td className="text-right">{d.score}</td><td /></tr>
              </tbody>
            </table>
          </TableWrap>
        </Card>

        {o && (
          <Card>
            <CardHead term="affordability" title="Limit, pricing and affordability" sub="The offer is the lowest of the request, the band limit grid, the affordability cap and the program maximum" />
            <div className="px-5 pb-5 grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Row k="Requested" v={usd(o.requested)} />
              <Row k={`Band ${o.band} grid limit (${policy.pricing.limitPctOfRevenue[o.band]}% of annual revenue)`} v={usd(o.gridLimit)} />
              <Row k={`DSCR room (NOCF ÷ ${policy.affordability.minDscr} − existing debt)`} v={`${usd(a.netOperatingCashFlow / policy.affordability.minDscr - a.existingDebtMonthly)}/mo`} />
              <Row k={`Revenue room (${policy.affordability.maxPaymentPctRevenue}% of monthly revenue)`} v={`${usd((a.avgMonthlyRevenue * policy.affordability.maxPaymentPctRevenue) / 100)}/mo`} />
              <Row k="Max affordable payment" v={`${usd(o.maxAffordablePayment)}/mo`} />
              <Row k="Affordability limit (principal)" v={usd(o.affordabilityLimit)} />
              <Row k="Program maximum" v={usd(policy.pricing.maxLoan)} />
              <Row k="Binding constraint" v={constraintLabel(o.bindingConstraint)} />
              <div className="sm:col-span-2 border-t pt-3 mt-1 grid sm:grid-cols-4 gap-3">
                <Big k="Offer" v={o.amount ? usd(o.amount) : "None"} />
                <Big k="APR" v={`${o.aprPct}%`} />
                <Big k="Term / payment" v={`${o.termMonths} mo · ${usd(o.monthlyPayment)}`} />
                <Big k="DSCR after loan" v={`${o.dscrAfter.toFixed(2)}x`} />
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="space-y-4">
        <HumanActions b={b} d={d} policy={policy} />
        <Card>
          <CardHead title="Attributes" sub="Computed from the 12-month pre-application bank window" />
          <div className="px-5 pb-5 space-y-2">
            {ATTRIBUTE_META.map((m) => {
              const line = d.scoreLines.find((l) => l.attribute === m.key);
              const f = line ? line.points / line.maxPoints : null;
              return (
                <div key={m.key} className="flex items-center justify-between gap-3 text-sm" title={m.help}>
                  <span className="text-muted-foreground flex items-center">
                    <span className={cn("h-2 w-2 rounded-full mr-2 shrink-0", f == null ? "bg-foreground/15" : f >= 0.7 ? "bg-gain" : f >= 0.4 ? "bg-warn" : "bg-loss")} title={f == null ? "Not scored" : `${line!.points} of ${line!.maxPoints} points`} />
                    {m.label}
                  </span>
                  <span className="tabular-nums font-medium">{formatAttr(m.key, a[m.key])}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="tabular-nums font-medium text-right">{v}</span></div>
);
const Big = ({ k, v }: { k: string; v: string }) => (
  <div><div className="micro">{k}</div><div className="text-base font-semibold tabular-nums">{v}</div></div>
);

function HumanActions({ b, d, policy }: { b: Business; d: Decision; policy: CreditPolicy }) {
  const { recordHuman } = useStore();
  const pending = finalStatus(d) === "PENDING_REVIEW";
  const [mode, setMode] = useState<"none" | "APPROVE" | "DECLINE">("none");
  const [note, setNote] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const maxAmount = d.offer?.amount || d.inputs.application.requestedAmount;
  const [amount, setAmount] = useState(Math.min(maxAmount, d.inputs.application.requestedAmount));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (d.human) return null;
  const kycFail = d.kycOutcome === "fail";
  const kind = pending ? "review" : "override";
  const canApprove = !kycFail && (pending || d.engineOutcome === "DECLINE");
  const canDecline = pending || d.engineOutcome === "APPROVE";
  const valid = note.trim().length >= 10 && (mode === "APPROVE" ? amount >= policy.pricing.minLoan && amount <= maxAmount : codes.length > 0);

  const submit = async () => {
    if (mode === "none") return;
    setBusy(true);
    setErr("");
    try {
      await recordHuman(b.id, { action: mode, note: note.trim(), reasonCodes: codes, amount });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={pending ? "ring-2 ring-warn/40" : ""}>
      <CardHead
        title={pending ? "Manual review" : "Override"}
        sub={pending ? "This application is waiting for an analyst. Your decision, note and reasons are stored on the decision record." : "Reverse the automated outcome. Overrides require a written justification and are flagged in the audit log."}
      />
      <div className="px-5 pb-5 space-y-3">
        {kycFail && <p className="text-xs text-loss flex gap-1.5"><ShieldAlert className="h-4 w-4 shrink-0" />KYC / KYB failures cannot be overridden to approve.</p>}
        <div className="flex gap-2">
          {canApprove && <Button variant={mode === "APPROVE" ? "primary" : "outline"} onClick={() => setMode("APPROVE")}>{pending ? "Approve" : "Override to approve"}</Button>}
          {canDecline && <Button variant={mode === "DECLINE" ? "danger" : "outline"} onClick={() => setMode("DECLINE")}>{pending ? "Decline" : "Override to decline"}</Button>}
        </div>
        {mode === "APPROVE" && (
          <Field label="Amount to book" hint={`Between ${usd(policy.pricing.minLoan)} and ${usd(maxAmount)}. Priced on the band ${d.band === "E" ? "D" : d.band} grid.`}>
            <input type="number" className="inp w-full" value={amount} min={policy.pricing.minLoan} max={maxAmount} step={1000} onChange={(e) => setAmount(Number(e.target.value))} />
          </Field>
        )}
        {mode === "DECLINE" && (
          <Field label="Decline reasons (at least one)">
            <div className="space-y-1.5">
              {HUMAN_DECLINE_REASONS.map((r) => (
                <label key={r.code} className="flex gap-2 text-sm items-start">
                  <input type="checkbox" className="mt-1" checked={codes.includes(r.code)} onChange={(e) => setCodes(e.target.checked ? [...codes, r.code] : codes.filter((c) => c !== r.code))} />
                  <span>{r.text}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        {mode !== "none" && (
          <>
            <Field label="Justification (required, min 10 characters)">
              <textarea className="inp w-full h-20 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you verify? Which mitigants or concerns drove the decision?" />
            </Field>
            <Button disabled={!valid || busy} onClick={submit} variant={mode === "DECLINE" ? "danger" : "primary"}>{busy ? "Saving…" : `Record ${kind}`}</Button>
            {err && <p className="text-xs text-loss">{err}</p>}
          </>
        )}
      </div>
    </Card>
  );
}

const CAT_LABEL: Partial<Record<TxnCategory, string>> = { sales: "Sales", owner_contribution: "Owner contribution", loan_payment: "Debt payment", nsf_fee: "NSF fee" };

function BankTab({ b }: { b: Business }) {
  const [cat, setCat] = useState<string>("all");
  const [limit, setLimit] = useState(80);
  const txns = useMemo(() => {
    const sim = simulateAccount(b.id, industryByName(b.industry), b.application.appMonth, b.hidden, true);
    return sim.transactions.filter((t) => t.date.slice(0, 7) < b.application.appMonth).reverse();
  }, [b]);
  const data = b.months.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const shown = txns.filter((t) => cat === "all" || (cat === "flags" ? t.returned || t.category === "nsf_fee" : t.category === cat));
  return (
    <div className="space-y-4">
      <Card>
        <CardHead title="Monthly cash flow" sub="Shaded months are the 12-month underwriting window. Later months are post-application activity used by monitoring." />
        <div className="h-64 px-2 pb-4">
          <ResponsiveContainer>
            <ComposedChart data={data}>
              <CartesianGrid stroke={chartColors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} />
              <YAxis tickFormatter={(v) => usd(v, true)} tick={{ fontSize: 11, fill: chartColors.axis }} width={56} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => usd(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="revenue" name="Revenue" stroke={chartColors.c2} fill={chartColors.c2} fillOpacity={0.15} />
              <Line dataKey="operatingExpenses" name="Operating expenses" stroke={chartColors.c3} dot={false} strokeWidth={1.5} />
              <Line dataKey="endBalance" name="Month-end balance" stroke={chartColors.c1} dot={false} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Month</th><th>Window</th><th className="text-right">Revenue</th><th className="text-right">Opex</th><th className="text-right">Debt service</th><th className="text-right">Owner in</th><th className="text-right">NSF</th><th className="text-right">Avg balance</th><th className="text-right">Min balance</th></tr></thead>
            <tbody>
              {b.months.map((m) => (
                <tr key={m.month} className={m.phase === "pre" ? "bg-muted/30" : ""}>
                  <td>{monthLabel(m.month)}</td>
                  <td className="text-muted-foreground">{m.phase === "pre" ? "Underwriting" : "Post-application"}</td>
                  <td className="text-right">{usd(m.revenue)}</td>
                  <td className="text-right">{usd(m.operatingExpenses)}</td>
                  <td className="text-right">{usd(m.debtPayments)}</td>
                  <td className="text-right">{m.ownerContributions ? usd(m.ownerContributions) : "—"}</td>
                  <td className={`text-right ${m.nsfCount ? "text-loss font-medium" : ""}`}>{m.nsfCount}</td>
                  <td className="text-right">{usd(m.avgBalance)}</td>
                  <td className={`text-right ${m.minBalance < 0 ? "text-loss" : ""}`}>{usd(m.minBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <Card>
        <CardHead title="Transactions (underwriting window)" sub={`${txns.length.toLocaleString()} synthetic transactions, newest first`} right={
          <select className="inp" value={cat} onChange={(e) => { setCat(e.target.value); setLimit(80); }}>
            <option value="all">All categories</option>
            <option value="flags">NSF / returned only</option>
            {["sales", "payroll", "rent", "inventory", "operating", "loan_payment", "owner_contribution", "owner_draw", "tax", "utilities"].map((c) => <option key={c} value={c}>{CAT_LABEL[c as TxnCategory] ?? c.replace("_", " ")}</option>)}
          </select>
        } />
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {shown.slice(0, limit).map((t, i) => (
                <tr key={i} className={t.returned ? "text-loss" : ""}>
                  <td>{t.date}</td>
                  <td>{t.description}</td>
                  <td className="text-muted-foreground">{CAT_LABEL[t.category] ?? t.category.replace("_", " ")}</td>
                  <td className={`text-right ${t.amount > 0 ? "text-gain" : ""}`}>{t.amount > 0 ? "+" : ""}{usd(t.amount)}</td>
                  <td className="text-right">{usd(t.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {shown.length > limit && <div className="p-3 text-center"><button className="text-sm underline text-muted-foreground" onClick={() => setLimit(limit + 200)}>Show more</button></div>}
      </Card>
    </div>
  );
}

function KycTab({ b }: { b: Business }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {(["KYB", "KYC"] as const).map((g) => (
        <Card key={g}>
          <CardHead title={g === "KYB" ? "Know your business" : "Know your customer (principal owner)"} sub="Mocked providers; results are seeded per applicant" />
          <div className="px-5 pb-5 space-y-3">
            {b.kyc.filter((c) => c.group === g).map((c) => (
              <div key={c.id} className="flex gap-3 items-start">
                <StatusPill s={c.status} />
                <div className="text-sm">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-muted-foreground text-xs">{c.provider} · {c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function AssistantTab({ b, d }: { b: Business; d: Decision }) {
  const { logAi } = useStore();
  const [out, setOut] = useState<AiOutput | null>(null);
  const declined = finalStatus(d) === "DECLINED";
  const run = (task: AiTask) => {
    const o = task === "screen_documents" ? screenDocuments(b, d) : task === "credit_memo" ? draftCreditMemo(b, d) : explainDecline(b, d);
    setOut(o);
    logAi(task, b.id, o);
  };
  return (
    <div className="grid lg:grid-cols-3 gap-4">
      <Card>
        <CardHead title="Assistant tasks" sub="Read-only. Each output is logged to the audit trail as advisory." />
        <div className="px-5 pb-5 space-y-2">
          {(["screen_documents", "credit_memo", "explain_decline"] as AiTask[]).map((t) => (
            <Button key={t} variant="outline" className="w-full justify-start" disabled={t === "explain_decline" && !declined} onClick={() => run(t)}>
              <Bot className="h-4 w-4" />{AI_TASK_LABEL[t]}
            </Button>
          ))}
          {!declined && <p className="text-[11px] text-muted-foreground">Decline explanation is available only for declined applications.</p>}
          <div className="rounded-2xl bg-muted/60 p-3 text-[11px] text-muted-foreground leading-relaxed mt-3">
            Demo mode uses deterministic templates over the stored decision. In production this calls an LLM from a server-side function with the same read-only inputs. The assistant has no write access to decisions, policy or the review queue.
          </div>
        </div>
      </Card>
      <Card className="lg:col-span-2">
        {out ? (
          <>
            <CardHead title={out.title} sub={`Grounded on: ${out.grounding.join(", ")}`} right={<Pill tone="warn">Advisory</Pill>} />
            <div className="px-5 pb-5">
              <RichText text={out.body} />
              <p className="text-[11px] text-muted-foreground mt-4 border-t pt-3">{out.disclaimer}</p>
            </div>
          </>
        ) : (
          <Empty>Pick a task to generate a draft.</Empty>
        )}
      </Card>
    </div>
  );
}

