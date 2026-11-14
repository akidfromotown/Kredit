// Modules 1 & 5: synthetic dataset description and scorecard validation on the development sample.
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { DATASET_SEED, industryByName } from "../engine/data";
import { validateScorecard } from "../engine/portfolio";
import { Card, CardHead, PageHeader, Pill, Stat, TableWrap, chartColors, pct, tooltipStyle, usd } from "../components/ui";

export default function DataModelPage() {
  const { world } = useStore();
  const m = useMemo(() => {
    const synth = world.businesses.filter((b) => b.source === "synthetic");
    const rows = synth.map((b) => ({ score: world.decisions[b.id].score, band: world.decisions[b.id].band, bad: b.outcomeBad12m }));
    const v = validateScorecard(rows);
    const ind: Record<string, number> = {};
    synth.forEach((b) => (ind[b.industry] = (ind[b.industry] ?? 0) + 1));
    const st: Record<string, number> = {};
    synth.forEach((b) => (st[b.state] = (st[b.state] ?? 0) + 1));
    const bins: { label: string; n: number; bad: number; rate: number }[] = [];
    for (let lo = 300; lo < 650; lo += 25) {
      const rs = rows.filter((r) => r.score >= lo && r.score < lo + 25);
      if (rs.length) bins.push({ label: `${lo}`, n: rs.length, bad: rs.filter((r) => r.bad).length, rate: (rs.filter((r) => r.bad).length / rs.length) * 100 });
    }
    const txnEstimate = synth.reduce((s, b) => s + (industryByName(b.industry).model === "b2c" ? 13 : 7) * 12 + 30 * 12 + (b.hidden.debt?.kind === "mca" ? 250 : 12), 0);
    const totalRev = synth.reduce((s, b) => s + world.decisions[b.id].inputs.attributes.avgMonthlyRevenue * 12, 0);
    return { synth, v, ind: Object.entries(ind).sort((a, b) => b[1] - a[1]), st: Object.entries(st).sort((a, b) => b[1] - a[1]).slice(0, 10), bins, txnEstimate, totalRev };
  }, [world]);

  return (
    <div>
      <PageHeader title="Data and model" sub="How the synthetic dataset is built and how well the scorecard rank-orders risk on it." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Businesses" value={m.synth.length} sub={`seed "${DATASET_SEED}" · ${world.businesses.length - m.synth.length} onboarded`} />
        <Stat label="Bank transactions" value={`~${Math.round(m.txnEstimate / 1000)}k`} sub="12 months each, pre-application" />
        <Stat label="Verified annual revenue" value={usd(m.totalRev, true)} sub="sum across applicants" />
        <Stat label="Dev-sample bad rate" value={pct((m.v.bads / m.v.n) * 100)} sub={`${m.v.bads} of ${m.v.n} · 60+ DPD in 12 months`} />
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card className="xl:col-span-2">
          <CardHead title="Scorecard validation" sub="Score distribution (bars) and bad rate by score bucket (line) on the development sample" right={<div className="flex gap-1.5"><Pill tone="solid">Gini {m.v.gini.toFixed(2)}</Pill><Pill tone="solid">KS {m.v.ks.toFixed(1)}</Pill><Pill tone="outline">AUC {m.v.auc.toFixed(3)}</Pill></div>} />
          <div className="h-72 px-2 pb-4">
            <ResponsiveContainer>
              <ComposedChart data={m.bins}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} />
                <YAxis yAxisId="l" tick={{ fontSize: 11, fill: chartColors.axis }} width={32} />
                <YAxis yAxisId="r" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: chartColors.axis }} width={40} />
                <Tooltip {...tooltipStyle} formatter={(v: number, n: string) => (n === "Bad rate" ? `${v.toFixed(1)}%` : v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="l" dataKey="n" name="Applicants" fill={chartColors.c4} radius={[6, 6, 0, 0]} />
                <Line yAxisId="r" dataKey="rate" name="Bad rate" stroke={chartColors.c3} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card>
          <CardHead title="Bad rate by band" />
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Band</th><th className="text-right">Applicants</th><th className="text-right">Bads</th><th className="text-right">Bad rate</th></tr></thead>
              <tbody>{m.v.byBand.map((b) => <tr key={b.band}><td className="font-semibold">{b.band}</td><td className="text-right">{b.n}</td><td className="text-right">{b.bads}</td><td className="text-right font-medium">{pct(b.badRate)}</td></tr>)}</tbody>
            </table>
          </TableWrap>
        </Card>
      </div>

      <div className="grid gap-4 mt-4">
        <Card>
          <CardHead title="Industry mix" />
          <div className="px-5 pb-2 h-64">
            <ResponsiveContainer>
              <BarChart data={m.ind.map(([k, v]) => ({ k, v }))} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="k" width={150} tick={{ fontSize: 11, fill: chartColors.axis }} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="v" name="Businesses" fill={chartColors.c1} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="px-5 pb-5 text-xs text-muted-foreground">Top states: {m.st.map(([s, n]) => `${s} ${n}`).join(" · ")}</div>
        </Card>
      </div>
    </div>
  );
}
