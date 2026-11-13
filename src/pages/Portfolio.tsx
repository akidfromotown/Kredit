// Module 10: portfolio dashboard.
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { finalStatus } from "../engine/decision";
import { monthLabel } from "../engine/dates";
import { isOpen, lossForecast, monthlyTrend } from "../engine/portfolio";
import { is30Plus } from "../engine/loanSim";
import { BANDS } from "../engine/policy";
import { Card, CardHead, PageHeader, Stat, chartColors, pct, tooltipStyle, usd } from "../components/ui";

export default function PortfolioPage() {
  const { world, loans, triggers } = useStore();
  const m = useMemo(() => {
    const ds = Object.values(world.decisions);
    const status = ds.map(finalStatus);
    const approved = status.filter((s) => s === "APPROVED").length;
    const declined = status.filter((s) => s === "DECLINED").length;
    const pending = status.filter((s) => s === "PENDING_REVIEW").length;
    const auto = ds.filter((d) => d.engineOutcome !== "REVIEW" && !d.human).length;
    const overrides = ds.filter((d) => d.human?.kind === "override").length;
    const open = loans.filter((l) => isOpen(l.bucket));
    const outstanding = open.reduce((s, l) => s + l.balance, 0);
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
    const reasons: Record<string, number> = {};
    ds.filter((d) => d.engineOutcome === "DECLINE").forEach((d) => {
      const r = d.reasons[0];
      const key = r.stage === "score" ? "Score below cutoff" : r.stage === "kyc" ? "KYC / KYB failed" : r.stage === "affordability" ? "Affordability cap" : r.code;
      reasons[key] = (reasons[key] ?? 0) + 1;
    });
    const bandMix = BANDS.map((b) => ({ band: b, balance: open.filter((l) => l.band === b).reduce((s, l) => s + l.balance, 0), count: open.filter((l) => l.band === b).length }));
    return { n: ds.length, approved, declined, pending, auto, overrides, open, outstanding, d30, co, originated, wapr, fc, trend, funnel, reasons, bandMix };
  }, [world, loans]);

  const fc12 = m.fc.points[m.fc.points.length - 1]?.cumulativeNet ?? 0;
  const topReasons = Object.entries(m.reasons).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxReason = topReasons[0]?.[1] ?? 1;
  const highTriggers = triggers.filter((t) => t.severity === "high").length;

  return (
    <div>
      <PageHeader title="Portfolio" sub="Twelve monthly vintages of in-house small-business term loans. All figures come from the synthetic book and the decisions stored in the audit log." />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Stat label="Applications" value={m.n.toLocaleString()} sub={`${m.pending} pending review`} />
        <Stat label="Approval rate" value={pct((m.approved / Math.max(m.approved + m.declined, 1)) * 100)} sub={`${m.approved} approved · ${m.declined} declined`} />
        <Stat label="Straight-through" value={pct((m.auto / m.n) * 100)} sub={`${m.overrides} human overrides`} />
        <Stat label="Outstanding" value={usd(m.outstanding, true)} sub={`${m.open.length} open loans · ${usd(m.originated, true)} originated`} />
        <Stat label="30+ DPD" value={pct((m.d30 / Math.max(m.outstanding, 1)) * 100, 2)} sub={`${usd(m.d30, true)} of balance`} tone={m.d30 / Math.max(m.outstanding, 1) > 0.04 ? "loss" : undefined} />
        <Stat label="Projected 12m net loss" value={usd(fc12, true)} sub={`${pct((fc12 / Math.max(m.fc.startBalance, 1)) * 100)} of balance · ${usd(m.co, true)} charged off to date`} tone="warn" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHead title="Originations and delinquency" sub="Monthly originations (bars) and 30+ DPD as % of outstanding balance (line)" />
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer>
              <ComposedChart data={m.trend}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} />
                <YAxis yAxisId="l" tickFormatter={(v) => usd(v, true)} tick={{ fontSize: 11, fill: chartColors.axis }} width={56} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v.toFixed(1)}%`} tick={{ fontSize: 11, fill: chartColors.axis }} width={44} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => (n === "30+ DPD %" ? `${v.toFixed(2)}%` : usd(v))} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="originations" name="Originations" fill={chartColors.c1} radius={[6, 6, 0, 0]} />
                <Line yAxisId="r" dataKey="dpd30Rate" name="30+ DPD %" stroke={chartColors.c3} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHead title="Decisions by application month" sub="Final status after any human review or override" />
          <div className="h-64 px-2 pb-4">
            <ResponsiveContainer>
              <BarChart data={m.funnel}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} />
                <YAxis tick={{ fontSize: 11, fill: chartColors.axis }} width={32} />
                <Tooltip {...tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Approved" stackId="a" fill={chartColors.c2} />
                <Bar dataKey="Declined" stackId="a" fill={chartColors.c3} />
                <Bar dataKey="Pending" stackId="a" fill={chartColors.c5} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHead title="Outstanding by risk band" sub="Open balance and loan count" />
          <div className="px-5 pb-5 space-y-2.5">
            {m.bandMix.map((b) => (
              <div key={b.band} className="flex items-center gap-3 text-sm">
                <span className="w-6 font-semibold">{b.band}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary/70" style={{ width: `${(b.balance / Math.max(m.outstanding, 1)) * 100}%` }} /></div>
                <span className="w-20 text-right tabular-nums">{usd(b.balance, true)}</span>
                <span className="w-10 text-right text-muted-foreground tabular-nums">{b.count}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Automated decline drivers" sub="Primary reason on engine declines" />
          <div className="px-5 pb-5 space-y-2">
            {topReasons.map(([k, v]) => (
              <div key={k} className="text-sm">
                <div className="flex justify-between"><span>{k}</span><span className="tabular-nums text-muted-foreground">{v}</span></div>
                <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden"><div className="h-full bg-loss/60" style={{ width: `${(v / maxReason) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardHead title="Early warnings" sub="Active monitoring triggers on open loans" right={<a href="#monitoring" className="text-xs underline text-muted-foreground">Open monitoring</a>} />
          <div className="px-5 pb-5 grid grid-cols-2 gap-3">
            <div><div className="micro">Accounts flagged</div><div className="text-2xl font-bold">{new Set(triggers.map((t) => t.loanId)).size}</div></div>
            <div><div className="micro">High severity</div><div className="text-2xl font-bold text-loss">{highTriggers}</div></div>
            <div><div className="micro">Weighted APR</div><div className="text-2xl font-bold">{m.wapr.toFixed(1)}%</div></div>
            <div><div className="micro">Charged off</div><div className="text-2xl font-bold">{loans.filter((l) => l.bucket === "chargedoff").length}</div></div>
          </div>
        </Card>
      </div>
    </div>
  );
}
