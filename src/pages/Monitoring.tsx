// Module 8: monitoring — account triggers, vintage table, roll rates.
import { useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { summarizeWarnings, type AiOutput } from "../engine/assistant";
import { AS_OF, AS_OF_MONTH, addMonths, monthLabel } from "../engine/dates";
import { BUCKET_LABEL } from "../engine/loanSim";
import { CREDIBILITY_K, ROLL_FROM, ROLL_TO, avgRollMatrix, blendedRollMatrix, rollMatrix, vintageTable, type Severity } from "../engine/portfolio";
import { Button, Card, CardHead, Empty, PageHeader, Pill, RichText, StatusPill, TableWrap, Tabs, chartColors, d8, tooltipStyle, usd } from "../components/ui";
import { go } from "../router";

export default function MonitoringPage() {
  const { loans, triggers, logAi } = useStore();
  const [sev, setSev] = useState<"all" | Severity>("all");
  const [rollView, setRollView] = useState<"latest" | "avg" | "blend">("avg");
  const [ai, setAi] = useState<AiOutput | null>(null);
  const vint = useMemo(() => vintageTable(loans), [loans]);
  const blend = useMemo(() => blendedRollMatrix(loans), [loans]);
  const roll = useMemo(() => (rollView === "latest" ? rollMatrix(loans, AS_OF_MONTH).matrix : rollView === "blend" ? blend.matrix : avgRollMatrix(loans)), [loans, rollView, blend]);
  const shown = triggers.filter((t) => sev === "all" || t.severity === sev);
  const loanById = new Map(loans.map((l) => [l.id, l]));
  const curves = Array.from({ length: 12 }, (_, i) => {
    const row: Record<string, number | string> = { mob: i + 1 };
    vint.forEach((v) => { if (v.cum30[i] != null && v.loans >= 5) row[monthLabel(v.vintage)] = Number(v.cum30[i]!.toFixed(2)); });
    return row;
  });
  const palette = ["hsl(var(--foreground))"];
  const maxCell = Math.max(1, ...vint.flatMap((v) => v.cum30.filter((x): x is number => x != null)));

  return (
    <div>
      <PageHeader title="Monitoring" sub={`Booked loans are re-checked monthly against refreshed bank data and payment status. As of ${d8(AS_OF)}.`} />

      <Card>
        <CardHead
          title="Account triggers"
          sub={`${triggers.length} active triggers on ${new Set(triggers.map((t) => t.loanId)).size} accounts`}
          right={
            <div className="flex gap-2 items-center">
              <Tabs value={sev} onChange={setSev} tabs={[{ id: "all", label: "All" }, { id: "high", label: "High" }, { id: "medium", label: "Medium" }, { id: "low", label: "Low" }]} />
              <Button variant="outline" onClick={() => { const o = summarizeWarnings(loans, triggers); setAi(o); logAi("summarize_warnings", undefined, o); }}><Bot className="h-4 w-4" />Summarize</Button>
            </div>
          }
        />
        {ai && (
          <div className="mx-5 mb-4 rounded-2xl border p-4">
            <div className="flex items-center gap-2 mb-2"><span className="font-semibold text-sm">{ai.title}</span><Pill tone="warn">Advisory</Pill><button className="ml-auto text-xs text-muted-foreground underline" onClick={() => setAi(null)}>Close</button></div>
            <RichText text={ai.body} />
            <p className="text-[11px] text-muted-foreground mt-3">{ai.disclaimer}</p>
          </div>
        )}
        {shown.length === 0 ? <Empty>No triggers.</Empty> : (
          <TableWrap className="max-h-[420px] overflow-y-auto">
            <table className="tbl">
              <thead className="sticky top-0 bg-card"><tr><th>Severity</th><th>Account</th><th>Trigger</th><th>Detail</th><th className="text-right">Balance</th><th>Band</th></tr></thead>
              <tbody>
                {shown.sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity)).map((t, i) => (
                  <tr key={i} className="cursor-pointer" onClick={() => go(`applications/${t.businessId}`)}>
                    <td><StatusPill s={t.severity} /></td>
                    <td><div className="font-medium">{t.businessName}</div><div className="text-[11px] text-muted-foreground">{t.loanId}</div></td>
                    <td className="font-mono text-xs">{t.code}</td>
                    <td className="whitespace-normal min-w-[280px]">{t.text}</td>
                    <td className="text-right">{usd(loanById.get(t.loanId)?.balance ?? 0)}</td>
                    <td>{loanById.get(t.loanId)?.band}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>

      <div className="grid xl:grid-cols-5 gap-4 mt-4">
        <Card className="xl:col-span-3">
          <CardHead title="Vintage table" sub="Cumulative % of loans ever 30+ DPD by months on book (MOB)" />
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Vintage</th><th className="text-right">Loans</th><th className="text-right">Funded</th>{Array.from({ length: 12 }, (_, i) => <th key={i} className="text-right">{i + 1}</th>)}</tr></thead>
              <tbody>
                {vint.map((v) => (
                  <tr key={v.vintage}>
                    <td>{monthLabel(v.vintage)}</td>
                    <td className="text-right">{v.loans}</td>
                    <td className="text-right">{usd(v.amount, true)}</td>
                    {v.cum30.map((c, i) => (
                      <td key={i} className="text-right text-xs" style={c != null && c > 0 ? { background: `hsl(var(--foreground) / ${(c / maxCell) * 0.22})` } : undefined}>{c == null ? "" : c.toFixed(1)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
        <Card className="xl:col-span-2">
          <CardHead title="Vintage curves" sub="Vintages with at least 5 loans" />
          <div className="h-72 px-2 pb-4">
            <ResponsiveContainer>
              <LineChart data={curves}>
                <CartesianGrid stroke={chartColors.grid} vertical={false} />
                <XAxis dataKey="mob" tick={{ fontSize: 11, fill: chartColors.axis }} label={{ value: "MOB", position: "insideBottomRight", offset: -2, fontSize: 11, fill: chartColors.axis }} />
                <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: chartColors.axis }} width={40} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {vint.filter((v) => v.loans >= 5).map((v, i) => (
                  <Line key={v.vintage} dataKey={monthLabel(v.vintage)} stroke={palette[i % palette.length]} strokeOpacity={0.4 + (0.6 * i) / Math.max(vint.length, 1)} dot={false} strokeWidth={1.5} connectNulls={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHead
          title="Roll rates"
          sub={rollView === "latest" ? `Balance-weighted transitions ${monthLabel(addMonths(AS_OF_MONTH, -1))} → ${monthLabel(AS_OF_MONTH)}` : rollView === "avg" ? "Balance-weighted average of the last 6 monthly transitions" : `Used by the loss forecast: observed 6-month rates credibility-weighted against a benchmark matrix (observed weight = exposure ÷ (exposure + ${usd(CREDIBILITY_K, true)}))`}
          right={<Tabs value={rollView} onChange={setRollView} tabs={[{ id: "avg", label: "Observed 6-month" }, { id: "latest", label: "Latest month" }, { id: "blend", label: "Forecast (blended)" }]} />}
        />
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>From \ to</th>{ROLL_TO.map((b) => <th key={b} className="text-right">{BUCKET_LABEL[b]}</th>)}{rollView === "blend" && <th className="text-right">Observed weight</th>}</tr></thead>
            <tbody>
              {ROLL_FROM.map((f, i) => (
                <tr key={f}>
                  <td className="font-medium">{BUCKET_LABEL[f]}</td>
                  {ROLL_TO.map((t, j) => {
                    const v = roll[i][j] * 100;
                    const worse = j > i && t !== "paidoff";
                    return <td key={t} className="text-right" style={v > 0.05 && worse ? { background: `hsl(var(--foreground) / ${Math.min(v / 100, 1) * 0.3 + 0.03})` } : undefined}>{v > 0.05 ? `${v.toFixed(1)}%` : "·"}</td>;
                  })}
                  {rollView === "blend" && <td className="text-right text-muted-foreground">{(blend.weights[i] * 100).toFixed(0)}%</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
