// Module 10: portfolio dashboard.
import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { finalStatus } from "../engine/decision";
import { monthLabel } from "../engine/dates";
import { isOpen, lossForecast, monthlyTrend } from "../engine/portfolio";
import { is30Plus, isDelinquent } from "../engine/loanSim";
import { BANDS } from "../engine/policy";
import { Card, CardHead, InfoTip, Stat, chartColors, cn, d8, pct, tooltipStyle, usd } from "../components/ui";

/** Band shades, lightest = lowest risk. Monochrome by design. */
const BAND_SHADE: Record<string, string> = { A: "bg-foreground/90", B: "bg-foreground/60", C: "bg-foreground/35", D: "bg-foreground/20", E: "bg-foreground/10" };

function Attention({ href, count, label, flag }: { href: string; count: string | number; label: string; flag: boolean }) {
  return (
    <a href={href} className="group glass rounded-2xl px-4 py-3.5 flex items-center gap-3 transition-colors hover:bg-foreground/[0.03]">
      <span className="num text-2xl leading-none">{count}</span>
      <span className="text-[13px] text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
      {flag && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
      <ArrowUpRight className="ml-auto h-4 w-4 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
    </a>
  );
}

/** Turns an audit entry into a short, human line: who/what, and what happened. */
function describe(e: { type: string; summary: string; ref: string; payload: unknown; actorType: string }): [string, string] {
  const name = e.summary.split(":")[0];
  const p = (e.payload ?? {}) as { outcome?: string; human?: { action?: string } };
  switch (e.type) {
    case "DECISION":
      return [name, p.outcome === "APPROVE" ? "approved automatically" : p.outcome === "DECLINE" ? "declined automatically" : "sent to review"];
    case "REVIEW_RESOLVED":
      return [name, p.human?.action === "APPROVE" ? "approved in review" : "declined in review"];
    case "OVERRIDE":
      return [name, p.human?.action === "APPROVE" ? "override: approved" : "override: declined"];
    case "POLICY_PUBLISHED":
      return [`Policy ${e.ref}`, "published"];
    case "AI_OUTPUT":
      return [name.replace(/ \(advisory only\)$/, ""), "AI draft"];
    default:
      return [name, e.type.toLowerCase().replace(/_/g, " ")];
  }
}

const change = (now: number, before: number, unit: "pts" | "%", goodWhenUp: boolean) => {
  const diff = unit === "pts" ? now - before : before ? ((now - before) / before) * 100 : 0;
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.05) return { text: "No change", good: null };
  const up = diff > 0;
  const digits = Math.abs(diff) < 1 ? 2 : 1;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(diff).toFixed(digits)}${unit === "pts" ? " pts" : "%"} vs last month`, good: up === goodWhenUp };
};

export default function PortfolioPage() {
  const { world, loans, triggers } = useStore();
  const m = useMemo(() => {
    const ds = Object.values(world.decisions);
    const status = ds.map(finalStatus);
    const approved = status.filter((s) => s === "APPROVED").length;
    const declined = status.filter((s) => s === "DECLINED").length;
    const pending = ds.filter((d) => finalStatus(d) === "PENDING_REVIEW").length;
    const open = loans.filter((l) => isOpen(l.bucket));
    const outstanding = open.reduce((s, l) => s + l.balance, 0);
    const late = open.filter((l) => isDelinquent(l.bucket));
    const d30 = open.filter((l) => is30Plus(l.bucket)).reduce((s, l) => s + l.balance, 0);
    const originated = loans.reduce((s, l) => s + l.amount, 0);
    const fc = lossForecast(loans);
    const trend = monthlyTrend(loans).map((p) => ({ ...p, label: monthLabel(p.month) }));
    const byMonth: Record<string, { label: string; Approved: number; Declined: number; Pending: number }> = {};
    ds.forEach((d) => {
      const k = d.inputs.application.appMonth;
      byMonth[k] ??= { label: monthLabel(k), Approved: 0, Declined: 0, Pending: 0 };
      const s = finalStatus(d);
      byMonth[k][s === "APPROVED" ? "Approved" : s === "DECLINED" ? "Declined" : "Pending"]++;
    });
    const funnel = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    const approvalByMonth = funnel.map((f) => (f.Approved / Math.max(f.Approved + f.Declined, 1)) * 100);
    const REASON_LABEL: Record<string, string> = {
      "KO-TIB": "Too new (under 12 months)", "KO-REV": "Revenue below minimum", "KO-NSF": "Frequent bounced payments", "KO-CASH": "Too little cash on hand",
      "KO-TREND": "Revenue falling sharply", "KO-DSR": "Too much existing debt", "KO-FICO": "Owner credit score too low", "KO-CONC": "Relies on one customer",
      "KO-IND": "Restricted industry", "KO-MISREP": "Revenue misstated",
    };
    const reasons: Record<string, number> = {};
    ds.filter((d) => d.engineOutcome === "DECLINE").forEach((d) => {
      const r = d.reasons[0];
      const key = r.stage === "score" ? "Score below cutoff" : r.stage === "kyc" ? "Identity checks failed" : r.stage === "affordability" ? "Can't afford a new payment" : REASON_LABEL[r.code] ?? r.code;
      reasons[key] = (reasons[key] ?? 0) + 1;
    });
    const bandMix = BANDS.map((b) => ({ band: b, balance: open.filter((l) => l.band === b).reduce((s, l) => s + l.balance, 0) })).filter((b) => b.balance > 0);
    const highAccounts = new Set(triggers.filter((t) => t.severity === "high").map((t) => t.loanId)).size;
    const activity = [...world.audit].reverse().filter((e) => e.type !== "KYC_COMPLETED" && e.type !== "APPLICATION_SUBMITTED").slice(0, 6);
    return { approved, declined, pending, open, outstanding, late, d30, originated, fc, trend, funnel, approvalByMonth, reasons, bandMix, highAccounts, activity };
  }, [world, loans, triggers]);

  const fc12 = m.fc.points[m.fc.points.length - 1]?.cumulativeNet ?? 0;
  const topReasons = Object.entries(m.reasons).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxReason = topReasons[0]?.[1] ?? 1;
  const t = m.trend;
  const last = t[t.length - 1], prev = t[t.length - 2];
  const ar = m.approvalByMonth;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-light tracking-tight pb-1">Overview</h1>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <Attention href="#review" count={m.pending} label="to review" flag={m.pending > 0} />
        <Attention href="#monitoring" count={m.highAccounts} label="high-risk warnings" flag={m.highAccounts > 0} />
        <Attention href="#collections" count={m.late.length} label="paying late" flag={m.late.length > 0} />
        <Attention href="#collections" count={usd(fc12, true)} label="expected loss" flag={false} />
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        <Card className="p-5 md:col-span-2">
          <div className="micro flex items-center">Outstanding<InfoTip term="outstanding" align="left" /></div>
          <div className="flex items-baseline gap-2 mt-3">
            <span className="num text-[40px] leading-none">{usd(m.outstanding, true)}</span>
            <span className="text-sm text-muted-foreground">of {usd(m.originated, true)} lent</span>
          </div>
          <div className="flex h-1.5 rounded-full overflow-hidden mt-5 gap-0.5 bg-foreground/[0.06]">
            {m.bandMix.map((b) => (
              <div key={b.band} className={cn("h-full", BAND_SHADE[b.band])} style={{ width: `${(b.balance / Math.max(m.originated, 1)) * 100}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-muted-foreground">
            {m.bandMix.map((b) => (
              <span key={b.band} className="flex items-center gap-1.5"><span className={cn("h-1.5 w-1.5 rounded-full", BAND_SHADE[b.band])} />Band {b.band} · {usd(b.balance, true)}</span>
            ))}
          </div>
        </Card>
        <Stat label="30+ days late" term="dpd30" value={pct((m.d30 / Math.max(m.outstanding, 1)) * 100, 2)} spark={t.map((p) => p.dpd30Rate)} sparkTone="loss"
          delta={prev ? change(last.dpd30Rate, prev.dpd30Rate, "pts", false) : undefined} />
        <Stat label="Approval rate" term="approvalRate" value={pct((m.approved / Math.max(m.approved + m.declined, 1)) * 100)} spark={ar}
          delta={ar.length > 1 ? change(ar[ar.length - 1], ar[ar.length - 2], "pts", true) : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHead title="Lending and late payments" term="dpd30" />
          <div className="h-60 px-2 pb-4">
            <ResponsiveContainer>
              <ComposedChart data={m.trend}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tickFormatter={(v) => usd(v, true)} tick={{ fontSize: 11, fill: chartColors.axis }} width={56} axisLine={false} tickLine={false} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fontSize: 11, fill: chartColors.axis }} width={44} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: "hsl(var(--foreground) / 0.04)" }} formatter={(v: number, n: string) => (n === "30+ days late" ? `${v.toFixed(2)}%` : usd(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={6} />
                <Bar yAxisId="l" dataKey="originations" name="Lent" fill={chartColors.c1} fillOpacity={0.55} radius={[4, 4, 0, 0]} />
                <Line yAxisId="r" dataKey="dpd30Rate" name="30+ days late" stroke={chartColors.c3} strokeWidth={1.75} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHead title="Decisions by month" />
          <div className="h-60 px-2 pb-4">
            <ResponsiveContainer>
              <BarChart data={m.funnel}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: chartColors.axis }} width={32} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} cursor={{ fill: "hsl(var(--foreground) / 0.04)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={6} />
                <Bar dataKey="Approved" stackId="a" fill={chartColors.c1} fillOpacity={0.7} />
                <Bar dataKey="Declined" stackId="a" fill={chartColors.c4} fillOpacity={0.6} />
                <Bar dataKey="Pending" stackId="a" fill={chartColors.c3} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <Card>
          <CardHead title="Recent activity" right={<a href="#audit" className="text-[11px] text-muted-foreground hover:text-foreground">Audit log</a>} />
          <ul className="px-5 pb-4">
            {m.activity.map((e) => {
              const [who, what] = describe(e);
              return (
                <li key={e.seq} className="flex items-baseline gap-2 py-2.5 border-t border-[hsl(var(--glass-line))] first:border-t-0 text-[13px]">
                  <span className="font-medium truncate">{who}</span>
                  <span className="text-muted-foreground shrink-0">{what}</span>
                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">{d8(e.at)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardHead title="Why applications are declined" />
          <div className="px-5 pb-5 space-y-3">
            {topReasons.map(([k, v]) => (
              <div key={k} className="text-[13px]">
                <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>
                <div className="h-1 rounded-full bg-foreground/[0.06] mt-1.5 overflow-hidden"><div className="h-full rounded-full bg-foreground/50" style={{ width: `${(v / maxReason) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
