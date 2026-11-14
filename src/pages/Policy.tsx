// Modules 4–6: credit policy editor (knockout rules, scorecard, bands & cutoffs, limit / pricing grids,
// affordability cap) with back-test impact preview and versioned publishing.
import { useMemo, useState } from "react";
import { History, Play, RotateCcw } from "lucide-react";
import { useStore } from "../store";
import { ATTRIBUTE_META, attrMeta } from "../engine/attributes";
import { decide, type Decision } from "../engine/decision";
import { BANDS, clonePolicy, nextVersion, scoreRange, type Band, type CreditPolicy, type Operator } from "../engine/policy";
import { Button, Card, CardHead, Field, PageHeader, Pill, Stat, StatusPill, TableWrap, Tabs, dt, pct, usd } from "../components/ui";

type Tab = "rules" | "scorecard" | "pricing" | "impact" | "history";
const OPS: Operator[] = ["<", "<=", ">", ">=", "=="];

export function policyDiff(a: unknown, b: unknown, path = ""): { path: string; from: unknown; to: unknown }[] {
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return a === b ? [] : [{ path, from: a, to: b }];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: { path: string; from: unknown; to: unknown }[] = [];
  for (const k of keys) {
    if (["version", "publishedAt", "publishedBy", "note"].includes(k) && path === "") continue;
    const label = Array.isArray(a) && (a as { id?: string; attribute?: string }[])[+k]?.id ? (a as { id: string }[])[+k].id
      : Array.isArray(a) && (a as { attribute?: string }[])[+k]?.attribute ? (a as { attribute: string }[])[+k].attribute : k;
    out.push(...policyDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${label}` : label));
  }
  return out;
}

export default function PolicyPage() {
  const { policy, world, publishPolicy } = useStore();
  const [draft, setDraft] = useState<CreditPolicy>(() => clonePolicy(policy));
  const [tab, setTab] = useState<Tab>("rules");
  const [note, setNote] = useState("");
  const changes = useMemo(() => policyDiff(policy, draft), [policy, draft]);
  const mutate = (fn: (p: CreditPolicy) => void) => { const p = clonePolicy(draft); fn(p); setDraft(p); };

  const [publishErr, setPublishErr] = useState("");
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    setPublishing(true);
    setPublishErr("");
    try {
      const p = await publishPolicy(draft, note);
      setDraft(clonePolicy(p));
      setNote("");
      setTab("history");
    } catch (e) {
      setPublishErr((e as Error).message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Credit policy"
        sub="One versioned policy holds the knockout rules, scorecard, bands, cutoffs, limit and pricing grids and the affordability cap. Edits stay in a draft until published. Published versions apply to new applications only; past decisions keep the version they were made under."
        right={<Pill tone="solid">Active {policy.version}</Pill>}
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[
          { id: "rules", label: "Knockout rules" }, { id: "scorecard", label: "Scorecard & cutoffs" }, { id: "pricing", label: "Limits, pricing & affordability" },
          { id: "impact", label: <span>Impact preview{changes.length > 0 && <span className="ml-1.5 text-[10px] bg-warn/20 text-warn rounded-full px-1.5">{changes.length}</span>}</span> },
          { id: "history", label: "Versions" },
        ]} />
        {changes.length > 0 && <Button variant="ghost" onClick={() => setDraft(clonePolicy(policy))}><RotateCcw className="h-4 w-4" />Discard draft</Button>}
      </div>

      {tab === "rules" && (
        <Card>
          <CardHead title="Knockout rules" sub="Evaluated after KYC/KYB and before scoring. Any enabled rule that fires declines the application, and its reason is stated on the decision." />
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>On</th><th>Code</th><th>Attribute</th><th>Declines when</th><th>Threshold</th><th>Requirement shown in decline reason</th></tr></thead>
              <tbody>
                {draft.rules.map((r, i) => (
                  <tr key={r.id} className={r.enabled ? "" : "opacity-50"}>
                    <td><input type="checkbox" checked={r.enabled} onChange={(e) => mutate((p) => { p.rules[i].enabled = e.target.checked; })} /></td>
                    <td className="font-mono text-xs">{r.reasonCode}</td>
                    <td>{attrMeta(r.attribute).label}</td>
                    <td>
                      <select className="inp h-8" value={r.operator} onChange={(e) => mutate((p) => { p.rules[i].operator = e.target.value as Operator; })}>
                        {OPS.map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </td>
                    <td><input type="number" className="inp h-8 w-28" value={r.threshold} onChange={(e) => mutate((p) => { p.rules[i].threshold = Number(e.target.value); })} /></td>
                    <td><input className="inp h-8 w-full min-w-[260px]" value={r.requirement} onChange={(e) => mutate((p) => { p.rules[i].requirement = e.target.value; })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <div className="px-5 py-3 text-xs text-muted-foreground">Attributes available: {ATTRIBUTE_META.map((m) => m.label).join(" · ")}</div>
        </Card>
      )}

      {tab === "scorecard" && <ScorecardEditor draft={draft} mutate={mutate} />}
      {tab === "pricing" && <PricingEditor draft={draft} mutate={mutate} />}
      {tab === "impact" && <Impact active={policy} draft={draft} changes={changes} note={note} setNote={setNote} onPublish={publish} worldSize={world.businesses.length} busy={publishing} error={publishErr} />}
      {tab === "history" && <Versions />}
    </div>
  );
}

function ScorecardEditor({ draft, mutate }: { draft: CreditPolicy; mutate: (fn: (p: CreditPolicy) => void) => void }) {
  const sc = draft.scorecard;
  const [lo, hi] = scoreRange(sc);
  return (
    <div className="grid xl:grid-cols-3 gap-4">
      <Card className="xl:col-span-2">
        <CardHead title="Points by characteristic" sub={`Base ${sc.basePoints} + characteristic points. Possible range ${lo}–${hi}. Bin edges are fixed in this demo; points are editable.`} />
        <div className="px-5 pb-5 grid md:grid-cols-2 gap-4">
          {sc.characteristics.map((c, ci) => (
            <div key={c.attribute} className="rounded-2xl border p-3">
              <div className="text-sm font-medium mb-2">{attrMeta(c.attribute).label}</div>
              {c.bins.map((b, bi) => (
                <div key={bi} className="flex items-center justify-between gap-2 text-sm py-0.5">
                  <span className="text-muted-foreground">{b.label}</span>
                  <input type="number" className="inp h-7 w-20 text-right" value={b.points} onChange={(e) => mutate((p) => { p.scorecard.characteristics[ci].bins[bi].points = Number(e.target.value); })} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHead title="Cutoffs" sub="Score ≥ approve cutoff auto-approves (if no other review trigger). Below decline cutoff declines with the top adverse factors as reasons." />
          <div className="px-5 pb-5 grid grid-cols-2 gap-3">
            <Field label="Approve cutoff"><input type="number" className="inp w-full" value={sc.approveCutoff} onChange={(e) => mutate((p) => { p.scorecard.approveCutoff = Number(e.target.value); })} /></Field>
            <Field label="Decline cutoff"><input type="number" className="inp w-full" value={sc.declineCutoff} onChange={(e) => mutate((p) => { p.scorecard.declineCutoff = Number(e.target.value); })} /></Field>
            <Field label="Base points"><input type="number" className="inp w-full" value={sc.basePoints} onChange={(e) => mutate((p) => { p.scorecard.basePoints = Number(e.target.value); })} /></Field>
          </div>
          {sc.declineCutoff > sc.approveCutoff && <p className="px-5 pb-4 text-xs text-loss">Decline cutoff must not exceed the approve cutoff.</p>}
        </Card>
        <Card>
          <CardHead title="Score bands" sub="Band drives the limit and pricing grids" />
          <div className="px-5 pb-5 space-y-2">
            {(["A", "B", "C", "D"] as const).map((b) => (
              <div key={b} className="flex items-center justify-between text-sm">
                <span>Band {b} floor</span>
                <input type="number" className="inp h-8 w-24 text-right" value={sc.bandFloors[b]} onChange={(e) => mutate((p) => { p.scorecard.bandFloors[b] = Number(e.target.value); })} />
              </div>
            ))}
            <div className="flex justify-between text-sm text-muted-foreground"><span>Band E</span><span>below D floor</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function PricingEditor({ draft, mutate }: { draft: CreditPolicy; mutate: (fn: (p: CreditPolicy) => void) => void }) {
  const pr = draft.pricing;
  return (
    <div className="grid xl:grid-cols-3 gap-4">
      <Card className="xl:col-span-2">
        <CardHead title="Limit and APR grid" sub="Limit is a % of verified annual revenue. APR is set by band and term. Band E is not priced." />
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Band</th><th>Limit % of revenue</th>{pr.terms.map((t) => <th key={t}>APR {t} mo</th>)}</tr></thead>
            <tbody>
              {BANDS.map((b: Band) => (
                <tr key={b}>
                  <td className="font-semibold">{b}</td>
                  <td><input type="number" className="inp h-8 w-20" value={pr.limitPctOfRevenue[b]} onChange={(e) => mutate((p) => { p.pricing.limitPctOfRevenue[b] = Number(e.target.value); })} /></td>
                  {pr.terms.map((t) => (
                    <td key={t}><input type="number" step={0.1} className="inp h-8 w-20" value={pr.apr[b][t]} onChange={(e) => mutate((p) => { p.pricing.apr[b][t] = Number(e.target.value); })} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHead title="Affordability cap" sub="The new payment must satisfy both tests" />
          <div className="px-5 pb-5 space-y-3">
            <Field label="Minimum DSCR (net operating cash flow ÷ total debt service)"><input type="number" step={0.05} className="inp w-full" value={draft.affordability.minDscr} onChange={(e) => mutate((p) => { p.affordability.minDscr = Number(e.target.value); })} /></Field>
            <Field label="Max new payment as % of monthly revenue"><input type="number" className="inp w-full" value={draft.affordability.maxPaymentPctRevenue} onChange={(e) => mutate((p) => { p.affordability.maxPaymentPctRevenue = Number(e.target.value); })} /></Field>
          </div>
        </Card>
        <Card>
          <CardHead title="Program limits" />
          <div className="px-5 pb-5 space-y-3">
            <Field label="Minimum loan"><input type="number" className="inp w-full" value={pr.minLoan} onChange={(e) => mutate((p) => { p.pricing.minLoan = Number(e.target.value); })} /></Field>
            <Field label="Maximum loan"><input type="number" className="inp w-full" value={pr.maxLoan} onChange={(e) => mutate((p) => { p.pricing.maxLoan = Number(e.target.value); })} /></Field>
            <Field label="Route to review above"><input type="number" className="inp w-full" value={pr.manualReviewAbove} onChange={(e) => mutate((p) => { p.pricing.manualReviewAbove = Number(e.target.value); })} /></Field>
          </div>
        </Card>
      </div>
    </div>
  );
}

interface Summary { approve: number; review: number; decline: number; offered: number; badRateApproved: number; approvedN: number }

function summarize(ds: Decision[], badById: Map<string, boolean>): Summary {
  const ap = ds.filter((d) => d.engineOutcome === "APPROVE");
  return {
    approve: ap.length,
    review: ds.filter((d) => d.engineOutcome === "REVIEW").length,
    decline: ds.filter((d) => d.engineOutcome === "DECLINE").length,
    offered: ap.reduce((s, d) => s + (d.offer?.amount ?? 0), 0),
    approvedN: ap.length,
    badRateApproved: ap.length ? (ap.filter((d) => badById.get(d.businessId)).length / ap.length) * 100 : 0,
  };
}

function Impact({ active, draft, changes, note, setNote, onPublish, worldSize, busy, error }: {
  active: CreditPolicy; draft: CreditPolicy; changes: ReturnType<typeof policyDiff>; note: string; setNote: (s: string) => void; onPublish: () => void; worldSize: number; busy: boolean; error: string;
}) {
  const { world } = useStore();
  const [ran, setRan] = useState<null | { a: Summary; b: Summary; moved: { name: string; id: string; from: string; to: string }[] }>(null);
  const invalid = draft.scorecard.declineCutoff > draft.scorecard.approveCutoff;
  const run = () => {
    const sample = world.businesses.filter((b) => b.source === "synthetic");
    const badById = new Map(sample.map((b) => [b.id, b.outcomeBad12m]));
    const da = sample.map((b) => decide(b, active, b.application.appliedOn));
    const db = sample.map((b) => decide(b, draft, b.application.appliedOn));
    const moved = da.map((d, i) => ({ name: d.businessName, id: d.businessId, from: d.engineOutcome, to: db[i].engineOutcome })).filter((m) => m.from !== m.to);
    setRan({ a: summarize(da, badById), b: summarize(db, badById), moved });
  };
  const row = (k: string, f: (s: Summary) => string) => ran && (
    <tr><td>{k}</td><td className="text-right">{f(ran.a)}</td><td className="text-right font-medium">{f(ran.b)}</td></tr>
  );
  return (
    <div className="grid xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card>
          <CardHead title="Back-test on the development sample" sub={`Re-runs all ${Math.min(worldSize, 500)} synthetic applications under the active policy and the draft. Bad rate uses each business's 12-month development outcome, which the engine never sees.`} right={<Button onClick={run} disabled={invalid}><Play className="h-4 w-4" />Run</Button>} />
          {ran ? (
            <div className="px-5 pb-5 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Auto-approve" value={ran.b.approve} sub={`${ran.b.approve - ran.a.approve >= 0 ? "+" : ""}${ran.b.approve - ran.a.approve} vs active`} />
                <Stat label="Review" value={ran.b.review} sub={`${ran.b.review - ran.a.review >= 0 ? "+" : ""}${ran.b.review - ran.a.review} vs active`} />
                <Stat label="Decline" value={ran.b.decline} sub={`${ran.b.decline - ran.a.decline >= 0 ? "+" : ""}${ran.b.decline - ran.a.decline} vs active`} />
                <Stat label="Outcomes changed" value={ran.moved.length} />
              </div>
              <TableWrap>
                <table className="tbl">
                  <thead><tr><th>Metric</th><th className="text-right">Active {active.version}</th><th className="text-right">Draft</th></tr></thead>
                  <tbody>
                    {row("Auto-approve rate", (s) => pct((s.approve / 500) * 100))}
                    {row("Bad rate of auto-approved (dev sample)", (s) => pct(s.badRateApproved))}
                    {row("Offered on auto-approvals", (s) => usd(s.offered, true))}
                  </tbody>
                </table>
              </TableWrap>
              {ran.moved.length > 0 && (
                <div>
                  <div className="micro mb-2">Changed outcomes (first 30)</div>
                  <div className="space-y-1">
                    {ran.moved.slice(0, 30).map((m) => (
                      <a key={m.id} href={`#applications-${m.id}`} className="flex items-center gap-2 text-sm hover:underline">
                        <span className="flex-1 truncate">{m.name}</span><StatusPill s={m.from} /><span className="text-muted-foreground">→</span><StatusPill s={m.to} />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : <div className="px-5 pb-5 text-sm text-muted-foreground">Run the back-test to compare the draft with the active policy.</div>}
        </Card>
      </div>
      <Card>
        <CardHead title="Publish draft" sub={`Becomes ${nextVersion(active.version)}. Logged with your note and the full policy snapshot.`} />
        <div className="px-5 pb-5 space-y-3">
          {changes.length === 0 ? <p className="text-sm text-muted-foreground">No changes from {active.version}.</p> : (
            <div className="space-y-1 max-h-60 overflow-auto">
              {changes.map((c) => (
                <div key={c.path} className="text-xs font-mono"><span className="text-muted-foreground">{c.path}</span>: {String(c.from)} → <b>{String(c.to)}</b></div>
              ))}
            </div>
          )}
          <Field label="Change note (required)"><textarea className="inp w-full h-20 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this change being made? Reference the committee approval." /></Field>
          <Button disabled={!changes.length || note.trim().length < 5 || invalid || busy} onClick={onPublish}>{busy ? "Publishing…" : `Publish ${nextVersion(active.version)}`}</Button>
          {error && <p className="text-xs text-loss">{error}</p>}
        </div>
      </Card>
    </div>
  );
}

function Versions() {
  const { world } = useStore();
  const ps = [...world.policies].reverse();
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    Object.values(world.decisions).forEach((d) => (c[d.policyVersion] = (c[d.policyVersion] ?? 0) + 1));
    return c;
  }, [world]);
  return (
    <Card>
      <CardHead title="Version history" sub="Every published version with its author, note, changes and the number of decisions made under it" />
      <div className="px-5 pb-5 space-y-4">
        {ps.map((p, i) => {
          const prev = ps[i + 1];
          const diff = prev ? policyDiff(prev, p) : [];
          return (
            <div key={p.version} className="rounded-2xl border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                <span className="font-semibold">{p.version}</span>
                {i === 0 && <Pill tone="solid">active</Pill>}
                <span className="text-xs text-muted-foreground">{dt(p.publishedAt)} UTC · {p.publishedBy} · {counts[p.version] ?? 0} decisions</span>
              </div>
              <p className="text-sm mt-1">{p.note}</p>
              {diff.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {diff.map((c) => <div key={c.path} className="text-xs font-mono"><span className="text-muted-foreground">{c.path}</span>: {String(c.from)} → <b>{String(c.to)}</b></div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
