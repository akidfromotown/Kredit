// Module 10: portfolio dashboard. Leads with what needs action, then the health of the book, then detail.
import { useMemo, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ClipboardCheck, Clock, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { finalStatus } from "../engine/decision";
import { monthLabel } from "../engine/dates";
import { isOpen, lossForecast, monthlyTrend } from "../engine/portfolio";
import { is30Plus, isDelinquent } from "../engine/loanSim";
import { BANDS } from "../engine/policy";
import { Card, CardHead, InfoTip, PageHeader, Stat, chartColors, cn, d8, pct, tooltipStyle, usd } from "../components/ui";

function ActionCard({ href, icon, tone, count, title, detail }: { href: string; icon: ReactNode; tone: "warn" | "loss" | "accent"; count: ReactNode; title: string; detail: string }) {
  return (
    <a href={href} className="group glass rounded-[22px] p-4 flex items-start gap-3 transition-transform hover:-translate-y-0.5">
      <span className={cn("grid place-items-center h-9 w-9 rounded-xl shrink-0", tone === "warn" && "bg-warn/15 text-warn", tone === "loss" && "bg-loss/15 text-loss", tone === "accent" && "bg-accent/15 text-accent")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-xl font-bold tabular-nums">{count}</span>
          <span className="text-sm font-medium">{title}</span>
        </span>
        <span className="block text-xs text-muted-foreground mt-0.5">{detail}</span>
      </span>
      <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground mt-1 shrink-0" />
    </a>
  );
}

const change = (now: number, before: number, unit: "pts" | "%", goodWhenUp: boolean) => {
  const diff = unit === "pts" ? now - before : before ? ((now - before) / before) * 100 : 0;
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.05) return { text: "No change vs last month", good: null };
  const up = diff > 0;
  const digits = Math.abs(diff) < 1 ? 2 : 1;
  return { text: `${up ? "▲" : "▼"} ${Math.abs(diff).toFixed(digits)}${unit === "pts" ? " pts" : "%"} vs last month`, good: up === goodWhenUp };
};

export default function PortfolioPage() {
  const { world, loans, triggers, policy } = useStore();
  const m = useMemo(() => {
    const ds = Object.values(world.decisions);
    const status = ds.map(finalStatus);
    const approved = status.filter((s) => s === "APPROVED").length;
    const declined = status.filter((s) => s === "DECLINED").length;
    const pendingDs = ds.filter((d) => finalStatus(d) === "PENDING_REVIEW").sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
    const auto = ds.filter((d) => d.engineOutcome !== "REVIEW" && !d.human).length;
    const overrides = ds.filter((d) => d.human?.kind === "override").length;
    const open = loans.filter((l) => isOpen(l.bucket));
    const outstanding = open.reduce((s, l) => s + l.balance, 0);
    const late = open.filter((l) => isDelinquent(l.bucket));
    const d30 = open.filter((l) => is30Plus(l.bucket)).reduce((s, l) => s + l.balance, 0);
    const co = loans.reduce((s, l) => s + l.chargedOff, 0);
    const originated = loans.reduce((s, l) => s + l.amount, 0);
    const wapr = outstanding ? open.reduce((s, l) => s + l.aprPct * l.balance, 0) / outstanding : 0;
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
    const reasons: Record<string, number> = {};
    const REASON_LABEL: Record<string, string> = {
      "KO-TIB": "Too new (under 12 months)", "KO-REV": "Revenue below minimum", "KO-NSF": "Frequent bounced payments", "KO-CASH": "Too little cash on hand",
      "KO-TREND": "Revenue falling sharply", "KO-DSR": "Too much existing debt", "KO-FICO": "Owner credit score too low", "KO-CONC": "Relies on one customer",
      "KO-IND": "Restricted industry", "KO-MISREP": "Revenue misstated",
    };
    ds.filter((d) => d.engineOutcome === "DECLINE").forEach((d) => {
      const r = d.reasons[0];
      const key = r.stage === "score" ? "Score below cutoff" : r.stage === "kyc" ? "Identity checks failed" : r.stage === "affordability" ? "Can't afford a new payment" : REASON_LABEL[r.code] ?? r.code;
      reasons[key] = (reasons[key] ?? 0) + 1;
    });
    const bandMix = BANDS.map((b) => ({ band: b, balance: open.filter((l) => l.band === b).reduce((s, l) => s + l.balance, 0), count: open.filter((l) => l.band === b).length }));
    const highAccounts = new Set(triggers.filter((t) => t.severity === "high").map((t) => t.loanId)).size;
    return { n: ds.length, approved, declined, pendingDs, auto, overrides, open, outstanding, late, d30, co, originated, wapr, fc, trend, funnel, approvalByMonth, reasons, bandMix, highAccounts };
  }, [world, loans, triggers]);

  const fc12 = m.fc.points[m.fc.points.length - 1]?.cumulativeNet ?? 0;
  const topReasons = Object.entries(m.reasons).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const maxReason = topReasons[0]?.[1] ?? 1;
  const t = m.trend;
  const last = t[t.length - 1], prev = t[t.length - 2];
  const ar = m.approvalByMonth;
  const lateBal = m.late.reduce((s, l) => s + l.balance, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Portfolio" sub={`${m.open.length} open loans across ${t.length} monthly vintages, decided under policy ${policy.version}. Every figure comes from decisions recorded in the audit log.`} />

      <section aria-label="Needs your attention">
        <div className="micro mb-2 px-1">Needs your attention</div>
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <ActionCard href="#review" icon={<ClipboardCheck className="h-4 w-4" />} tone="warn" count={m.pendingDs.length} title="applications to review"
            detail={m.pendingDs[0] ? `Oldest waiting since ${d8(m.pendingDs[0].decidedAt)}` : "Queue is clear"} />
          <ActionCard href="#monitoring" icon={<AlertTriangle className="h-4 w-4" />} tone="loss" count={m.highAccounts} title="high-risk warnings"
            detail={`${new Set(triggers.map((x) => x.loanId)).size} accounts have at least one warning`} />
          <ActionCard href="#collections" icon={<Clock className="h-4 w-4" />} tone="loss" count={m.late.length} title="loans paying late"
            detail={`${usd(lateBal, true)} of balance is past due`} />
          <ActionCard href="#collections" icon={<Wallet className="h-4 w-4" />} tone="accent" count={usd(fc12, true)} title="expected loss"
            detail="Next 12 months, after recoveries" />
        </div>
      </section>

      <section aria-label="Book health">
        <div className="micro mb-2 px-1">How the book is doing</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Stat label="Outstanding" term="outstanding" value={usd(m.outstanding, true)} spark={t.map((p) => p.outstanding)}
            delta={prev ? change(last.outstanding, prev.outstanding, "%", true) : undefined} sub={`${usd(m.originated, true)} lent in total`} />
          <Stat label="30+ days late" term="dpd30" value={pct((m.d30 / Math.max(m.outstanding, 1)) * 100, 2)} spark={t.map((p) => p.dpd30Rate)} sparkTone="loss"
            delta={prev ? change(last.dpd30Rate, prev.dpd30Rate, "pts", false) : undefined} tone={m.d30 / Math.max(m.outstanding, 1) > 0.04 ? "loss" : undefined} sub={`${usd(m.d30, true)} of balance`} />
          <Stat label="Approval rate" term="approvalRate" value={pct((m.approved / Math.max(m.approved + m.declined, 1)) * 100)} spark={ar} sparkTone="gain"
            delta={ar.length > 1 ? change(ar[ar.length - 1], ar[ar.length - 2], "pts", true) : undefined} sub={`${m.approved} approved · ${m.declined} declined`} />
          <Stat label="Decided automatically" term="straightThrough" value={pct((m.auto / m.n) * 100)} sub={`${m.overrides} human overrides`} />
          <Stat label="Average rate" value={`${m.wapr.toFixed(1)}%`} sub="APR, weighted by balance" />
          <Stat label="Written off so far" term="chargeOff" value={usd(m.co, true)} sub={`${loans.filter((l) => l.bucket === "chargedoff").length} loans`} />
        </div>
      </section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHead title="Lending and late payments" sub="Bars: amount lent each month. Line: share of balance 30+ days late." term="dpd30" />
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer>
              <ComposedChart data={m.trend}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="l" tickFormatter={(v) => usd(v, true)} tick={{ fontSize: 11, fill: chartColors.axis }} width={56} axisLine={false} tickLine={false} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fontSize: 11, fill: chartColors.axis }} width={44} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => (n === "30+ days late" ? `${v.toFixed(2)}%` : usd(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="originations" name="Lent" fill={chartColors.c1} radius={[8, 8, 0, 0]} fillOpacity={0.85} />
                <Line yAxisId="r" dataKey="dpd30Rate" name="30+ days late" stroke={chartColors.c3} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHead title="Decisions by month" sub="Final outcome of each month's applications, after any review or override" />
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer>
              <BarChart data={m.funnel}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: chartColors.axis }} width={32} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Approved" stackId="a" fill={chartColors.c2} />
                <Bar dataKey="Declined" stackId="a" fill={chartColors.c3} fillOpacity={0.8} />
                <Bar dataKey="Pending" stackId="a" fill={chartColors.c5} radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHead title="Where the money is, by risk band" sub="Open balance and number of loans. A is the lowest risk." term="band" />
          <div className="px-5 pb-5 space-y-3">
            {m.bandMix.map((b) => (
              <div key={b.band} className="flex items-center gap-3 text-sm">
                <span className="w-7 h-7 grid place-items-center rounded-lg glass-pill font-semibold text-xs">{b.band}</span>
                <div className="flex-1 h-2.5 rounded-full bg-foreground/5 overflow-hidden"><div className="h-full rounded-full bg-accent/70" style={{ width: `${(b.balance / Math.max(m.outstanding, 1)) * 100}%` }} /></div>
                <span className="w-20 text-right tabular-nums font-medium">{usd(b.balance, true)}</span>
                <span className="w-16 text-right text-muted-foreground tabular-nums text-xs">{b.count} loans</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Why applications are declined" sub="Main reason on automatic declines" right={<InfoTip term="knockout" align="right" />} />
          <div className="px-5 pb-5 space-y-2.5">
            {topReasons.map(([k, v]) => (
              <div key={k} className="text-sm">
                <div className="flex justify-between"><span>{k}</span><span className="tabular-nums text-muted-foreground">{v}</span></div>
                <div className="h-1.5 rounded-full bg-foreground/5 mt-1 overflow-hidden"><div className="h-full rounded-full bg-loss/60" style={{ width: `${(v / maxReason) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
