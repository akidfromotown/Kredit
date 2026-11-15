// Module 9: collections stages and loss forecast.
import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useStore } from "../store";
import { monthLabel } from "../engine/dates";
import { BUCKET_LABEL } from "../engine/loanSim";
import { COLLECTION_STAGES, RECOVERY_RATE, isOpen, lossForecast } from "../engine/portfolio";
import { Card, CardHead, Empty, PageHeader, Pill, Stat, TableWrap, chartColors, pct, tooltipStyle, usd } from "../components/ui";
import { go } from "../router";

export default function CollectionsPage() {
  const { loans, triggers } = useStore();
  const [stage, setStage] = useState(COLLECTION_STAGES[0].id);
  const fc = useMemo(() => lossForecast(loans), [loans]);
  const open = loans.filter((l) => isOpen(l.bucket));
  const outstanding = open.reduce((s, l) => s + l.balance, 0);
  const co = loans.filter((l) => l.bucket === "chargedoff");
  const st = COLLECTION_STAGES.find((s) => s.id === stage)!;
  const inStage = open.filter((l) => st.buckets.includes(l.bucket)).sort((a, b) => b.balance - a.balance);
  const total12 = fc.points[fc.points.length - 1]?.cumulativeNet ?? 0;
  const chart = fc.points.map((p) => ({ label: monthLabel(p.month), net: p.netLoss, cum: p.cumulativeNet }));
  const trigByLoan = new Map<string, string[]>();
  triggers.forEach((t) => trigByLoan.set(t.loanId, [...(trigByLoan.get(t.loanId) ?? []), t.code]));

  return (
    <div>
      <PageHeader title="Collections and loss forecast" sub="Delinquent accounts are worked in stages by days past due. The forecast rolls today's balances forward with observed roll rates." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {COLLECTION_STAGES.map((s) => {
          const ls = open.filter((l) => s.buckets.includes(l.bucket));
          const bal = ls.reduce((a, l) => a + l.balance, 0);
          return (
            <button key={s.id} onClick={() => setStage(s.id)} className="text-left">
              <Card className={`p-4 transition-colors ${stage === s.id ? "!bg-foreground/[0.07]" : ""}`}>
                <div className="micro h-4 truncate">{s.name} · {s.dpd} DPD</div>
                <div className="mt-3 flex items-baseline gap-1.5"><span className="num text-[30px] leading-none">{ls.length}</span><span className="text-xs text-muted-foreground">accounts</span>{stage === s.id && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-signal" />}</div>
                <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">{usd(bal, true)}</div>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="grid xl:grid-cols-3 gap-4 mt-4">
        <Card>
          <CardHead title={`${st.name} stage playbook`} sub={`${st.dpd} DPD · owner: ${st.owner}`} />
          <ol className="px-5 pb-5 space-y-2 text-sm list-decimal list-inside">{st.strategy.map((s) => <li key={s}>{s}</li>)}</ol>
        </Card>
        <Card className="xl:col-span-2">
          <CardHead title={`Accounts in ${st.name.toLowerCase()} stage`} sub="Largest balance first" />
          {inStage.length === 0 ? <Empty>No accounts in this stage.</Empty> : (
            <TableWrap>
              <table className="tbl">
                <thead><tr><th>Account</th><th>Bucket</th><th className="text-right">Balance</th><th className="text-right">Payment</th><th>Vintage</th><th>Band</th><th>Other signals</th></tr></thead>
                <tbody>
                  {inStage.map((l) => (
                    <tr key={l.id} className="cursor-pointer" onClick={() => go(`applications/${l.businessId}`)}>
                      <td><div className="font-medium">{l.businessName}</div><div className="text-[11px] text-muted-foreground">{l.id}</div></td>
                      <td><Pill tone="loss">{BUCKET_LABEL[l.bucket]}</Pill></td>
                      <td className="text-right">{usd(l.balance)}</td>
                      <td className="text-right">{usd(l.payment)}</td>
                      <td>{monthLabel(l.originationMonth)}</td>
                      <td>{l.band}</td>
                      <td className="space-x-1">{(trigByLoan.get(l.id) ?? []).filter((c) => c !== "DPD").map((c) => <Pill key={c} tone="outline" className="font-mono">{c}</Pill>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <Stat label="Open balance" value={usd(outstanding, true)} sub={`${open.length} loans`} />
        <Stat label="Charged off to date" value={usd(co.reduce((s, l) => s + l.chargedOff, 0), true)} sub={`${co.length} loans`} />
        <Stat label="Forecast 12m net loss" value={usd(total12, true)} sub={`${pct((total12 / Math.max(fc.startBalance, 1)) * 100)} of open balance`} />
        <Stat label="Assumptions" value={`${pct(RECOVERY_RATE * 100, 0)} recovery`} sub={`${pct(fc.amortRate * 100)} monthly paydown on current`} />
      </div>
      <Card className="mt-4">
        <CardHead title="12-month run-off loss forecast" sub="Net charge-offs per month (bars) and cumulative (line). Run-off only: no new originations. Uses the blended roll matrix on the Monitoring page: observed rates where the book has enough exposure, a benchmark where it is still thin." />
        <div className="h-72 px-2 pb-4">
          <ResponsiveContainer>
            <ComposedChart data={chart}>
              <CartesianGrid stroke={chartColors.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: chartColors.axis }} />
              <YAxis tickFormatter={(v) => usd(v, true)} tick={{ fontSize: 11, fill: chartColors.axis }} width={56} />
              <Tooltip {...tooltipStyle} formatter={(v: number) => usd(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="net" name="Net loss" fill={chartColors.c3} radius={[6, 6, 0, 0]} />
              <Line dataKey="cum" name="Cumulative" stroke={chartColors.c1} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Month</th><th className="text-right">Current</th><th className="text-right">1–30</th><th className="text-right">31–60</th><th className="text-right">61–90</th><th className="text-right">90+</th><th className="text-right">Gross CO</th><th className="text-right">Net loss</th></tr></thead>
            <tbody>
              {fc.points.map((p) => (
                <tr key={p.month}>
                  <td>{monthLabel(p.month)}</td>
                  {(["current", "dpd1_30", "dpd31_60", "dpd61_90", "dpd90p"] as const).map((b) => <td key={b} className="text-right">{usd(p.balances[b], true)}</td>)}
                  <td className="text-right">{usd(p.grossChargeOff)}</td>
                  <td className="text-right font-medium">{usd(p.netLoss)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
