// Applications list across the synthetic book and onboarded applicants.
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { finalStatus } from "../engine/decision";
import { Card, PageHeader, StatusPill, TableWrap, Tabs, d8, usd, Pill } from "../components/ui";
import { go } from "../router";

type Filter = "all" | "APPROVED" | "DECLINED" | "PENDING_REVIEW" | "override";

export default function ApplicationsPage() {
  const { world } = useStore();
  const [f, setF] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(50);
  const rows = useMemo(() => {
    const byId = new Map(world.businesses.map((b) => [b.id, b]));
    return Object.values(world.decisions)
      .map((d) => ({ d, b: byId.get(d.businessId)!, s: finalStatus(d) }))
      .filter(({ d, s }) => (f === "all" ? true : f === "override" ? d.human?.kind === "override" : s === f))
      .filter(({ b }) => !q || `${b.name} ${b.id} ${b.industry} ${b.state} ${b.owner.name}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.d.decidedAt.localeCompare(a.d.decidedAt));
  }, [world, f, q]);

  return (
    <div>
      <PageHeader title="Applications" sub="Every application with the engine outcome, the final status and the policy version used. Open one to see its inputs, rules, score, offer, bank data and audit trail." />
      <div className="flex flex-wrap gap-3 items-center mb-3">
        <Tabs<Filter>
          value={f}
          onChange={(v) => { setF(v); setLimit(50); }}
          tabs={[{ id: "all", label: "All" }, { id: "APPROVED", label: "Approved" }, { id: "DECLINED", label: "Declined" }, { id: "PENDING_REVIEW", label: "Pending review" }, { id: "override", label: "Overrides" }]}
        />
        <input className="inp w-full sm:w-72" placeholder="Search name, ID, industry, state, owner" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs text-muted-foreground">{rows.length} results</span>
      </div>
      <Card>
        <TableWrap>
          <table className="tbl">
            <thead>
              <tr><th>Business</th><th>Industry</th><th>Applied</th><th className="text-right">Requested</th><th className="text-right">Score</th><th>Band</th><th>Engine</th><th>Final</th><th>Policy</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map(({ d, b, s }) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => go(`applications/${b.id}`)}>
                  <td>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-[11px] text-muted-foreground">{b.id} · {b.state}{b.source === "onboarded" && " · onboarded"}</div>
                  </td>
                  <td className="text-muted-foreground">{b.industry}</td>
                  <td>{d8(b.application.appliedOn)}</td>
                  <td className="text-right">{usd(b.application.requestedAmount)}</td>
                  <td className="text-right font-medium">{d.score}</td>
                  <td>{d.band}</td>
                  <td><StatusPill s={d.engineOutcome} /></td>
                  <td className="space-x-1"><StatusPill s={s} />{d.human?.kind === "override" && <Pill tone="outline">override</Pill>}</td>
                  <td className="text-muted-foreground">{d.policyVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        {rows.length > limit && (
          <div className="p-3 text-center"><button className="text-sm underline text-muted-foreground" onClick={() => setLimit(limit + 100)}>Show more ({rows.length - limit} remaining)</button></div>
        )}
      </Card>
    </div>
  );
}
