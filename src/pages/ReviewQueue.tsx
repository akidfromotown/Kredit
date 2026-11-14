// Module 7: manual review queue.
import { useMemo } from "react";
import { useStore } from "../store";
import { finalStatus } from "../engine/decision";
import { Card, CardHead, Empty, PageHeader, Pill, Stat, TableWrap, d8, usd } from "../components/ui";
import { go } from "../router";

export default function ReviewQueuePage() {
  const { world } = useStore();
  const { pending, resolved } = useMemo(() => {
    const ds = Object.values(world.decisions).filter((d) => d.engineOutcome === "REVIEW");
    return {
      pending: ds.filter((d) => finalStatus(d) === "PENDING_REVIEW").sort((a, b) => a.decidedAt.localeCompare(b.decidedAt)),
      resolved: ds.filter((d) => d.human).sort((a, b) => b.human!.at.localeCompare(a.human!.at)),
    };
  }, [world]);
  const approvedShare = resolved.length ? (resolved.filter((d) => d.human!.action === "APPROVE").length / resolved.length) * 100 : 0;

  return (
    <div>
      <PageHeader title="Review queue" sub="Applications the engine routed to a person: scores in the review range, KYC refers, large exposures and stated-revenue mismatches. The analyst decides; the engine's reasons explain why the file is here." />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Waiting" value={pending.length} />
        <Stat label="Oldest" value={pending[0] ? d8(pending[0].decidedAt) : "—"} />
        <Stat label="Resolved" value={resolved.length} />
        <Stat label="Approved in review" value={`${approvedShare.toFixed(0)}%`} />
      </div>
      <Card>
        <CardHead title="Waiting for an analyst" sub="Oldest first. Open a file to approve or decline with reasons." />
        {pending.length === 0 ? <Empty>Queue is empty.</Empty> : (
          <TableWrap>
            <table className="tbl">
              <thead><tr><th>Business</th><th>Received</th><th className="text-right">Requested</th><th className="text-right">Offer</th><th className="text-right">Score</th><th>Why it's here</th></tr></thead>
              <tbody>
                {pending.map((d) => (
                  <tr key={d.id} className="cursor-pointer" onClick={() => go(`applications/${d.businessId}`)}>
                    <td className="font-medium">{d.businessName}</td>
                    <td>{d8(d.decidedAt)}</td>
                    <td className="text-right">{usd(d.inputs.application.requestedAmount)}</td>
                    <td className="text-right">{d.offer ? usd(d.offer.amount) : "—"}</td>
                    <td className="text-right">{d.score} ({d.band})</td>
                    <td className="space-x-1">{d.reasons.filter((r) => r.stage === "review").map((r) => <Pill key={r.code} tone="outline" className="font-mono">{r.code}</Pill>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card className="mt-4">
        <CardHead title="Recently resolved" />
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Business</th><th>Analyst</th><th>Resolved</th><th>Action</th><th>Note</th></tr></thead>
            <tbody>
              {resolved.slice(0, 25).map((d) => (
                <tr key={d.id} className="cursor-pointer" onClick={() => go(`applications/${d.businessId}`)}>
                  <td className="font-medium">{d.businessName}</td>
                  <td className="text-muted-foreground">{d.human!.by}</td>
                  <td>{d8(d.human!.at)}</td>
                  <td><Pill tone={d.human!.action === "APPROVE" ? "gain" : "loss"}>{d.human!.action.toLowerCase()}</Pill></td>
                  <td className="text-muted-foreground max-w-md truncate">{d.human!.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </div>
  );
}
