// Financial crime: alert queue (screening + transaction monitoring), screening hits, and connectors.
import { Fragment, useMemo, useState } from "react";
import { useStore } from "../store";
import { ACTION_LABEL, CONNECTORS, LIST_LABEL, alertStatuses, isClosed, type DispositionAction } from "../engine/fincrime";
import { Button, Card, CardHead, Empty, Field, PageHeader, Stat, TableWrap, Tabs, cn, d8, dt } from "../components/ui";
import { go } from "../router";

type Tab = "alerts" | "screening" | "connectors";
type Filter = "open" | "escalated" | "closed" | "all";

const SEV_DOT = { high: "bg-loss", medium: "bg-warn", low: "bg-muted-foreground" } as const;
const STATUS_LABEL = { open: "Open", escalated: "Escalated", cleared: "Cleared", referred: "Referred" } as const;

export default function FinCrimePage() {
  const { alerts } = useStore();
  const [tab, setTab] = useState<Tab>("alerts");
  const open = alerts.filter((a) => a.status === "open").length;
  const escalated = alerts.filter((a) => a.status === "escalated").length;
  const referred = alerts.filter((a) => a.status === "referred").length;
  const hits = alerts.filter((a) => a.source === "screening").length;

  return (
    <div>
      <PageHeader title="Financial crime" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Stat label="Open alerts" value={open} />
        <Stat label="Escalated" value={escalated} />
        <Stat label="Screening hits" value={hits} />
        <Stat label="Referred" value={referred} />
      </div>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "alerts", label: "Alerts" }, { id: "screening", label: "Screening" }, { id: "connectors", label: "Connectors" }]} />
      <div className="mt-4">
        {tab === "alerts" && <Alerts />}
        {tab === "screening" && <Screening />}
        {tab === "connectors" && <Connectors />}
      </div>
    </div>
  );
}

function Alerts() {
  const { alerts, world, recordDisposition } = useStore();
  const [filter, setFilter] = useState<Filter>("open");
  const [openId, setOpenId] = useState<string | null>(null);
  const history = useMemo(() => alertStatuses(world.audit), [world.audit.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = alerts.filter((a) =>
    filter === "all" ? true : filter === "closed" ? isClosed(a.status) : a.status === filter,
  ).sort((a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity) || b.raisedOn.localeCompare(a.raisedOn));

  return (
    <Card>
      <CardHead title="Alert queue" right={
        <Tabs<Filter> value={filter} onChange={(f) => { setFilter(f); setOpenId(null); }} tabs={[{ id: "open", label: "Open" }, { id: "escalated", label: "Escalated" }, { id: "closed", label: "Closed" }, { id: "all", label: "All" }]} />
      } />
      {rows.length === 0 ? <Empty>No alerts here.</Empty> : (
        <TableWrap>
          <table className="tbl">
            <thead><tr><th>Severity</th><th>Business</th><th>Type</th><th>Detail</th><th>Raised</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <tr className="cursor-pointer" onClick={() => setOpenId(openId === a.id ? null : a.id)}>
                    <td><span className="inline-flex items-center gap-1.5 text-[12px] capitalize"><span className={cn("h-1.5 w-1.5 rounded-full", SEV_DOT[a.severity])} />{a.severity}</span></td>
                    <td className="font-medium">{a.businessName}</td>
                    <td className="text-muted-foreground whitespace-normal"><div className="whitespace-normal min-w-[150px] max-w-[220px] text-[13px] leading-snug">{a.title}</div></td>
                    <td className="whitespace-normal"><div className="whitespace-normal min-w-[260px] max-w-[460px] text-[13px] leading-snug">{a.detail}</div></td>
                    <td className="text-muted-foreground">{d8(a.raisedOn)}</td>
                    <td><span className="inline-flex items-center gap-1.5 text-[12px]">{a.status === "open" && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}{STATUS_LABEL[a.status]}</span></td>
                  </tr>
                  {openId === a.id && (
                    <tr>
                      <td colSpan={6} className="whitespace-normal bg-foreground/[0.02]">
                        <AlertPanel
                          alertId={a.id}
                          businessId={a.businessId}
                          closed={isClosed(a.status)}
                          escalated={a.status === "escalated"}
                          history={history.get(a.id)?.history ?? []}
                          onSubmit={(action, note) => recordDisposition(a.id, action, note)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

function AlertPanel({ alertId, businessId, closed, escalated, history, onSubmit }: {
  alertId: string; businessId: string; closed: boolean; escalated: boolean;
  history: { action: DispositionAction; note: string; by: string; at: string }[];
  onSubmit: (action: DispositionAction, note: string) => Promise<void>;
}) {
  const [action, setAction] = useState<DispositionAction | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!action) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit(action, note);
      setAction(null);
      setNote("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid md:grid-cols-2 gap-5 py-2">
      <div className="space-y-2 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">{alertId}</span>
          <button className="text-[12px] underline text-muted-foreground hover:text-foreground" onClick={() => go(`applications/${businessId}`)}>Open application</button>
        </div>
        {history.length === 0 ? <p className="text-muted-foreground">No action yet.</p> : history.map((h, i) => (
          <div key={i} className="border-t border-[hsl(var(--glass-line))] pt-2">
            <div><span className="font-medium">{ACTION_LABEL[h.action]}</span> <span className="text-muted-foreground">· {h.by} · {dt(h.at)}</span></div>
            <div className="text-muted-foreground">{h.note}</div>
          </div>
        ))}
      </div>
      {!closed && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["clear", "escalate", "refer"] as DispositionAction[]).filter((x) => !(x === "escalate" && escalated)).map((x) => (
              <Button key={x} variant={action === x ? "primary" : "outline"} onClick={() => setAction(x)}>{ACTION_LABEL[x]}</Button>
            ))}
          </div>
          {action && (
            <>
              <Field label="Note (required)">
                <textarea className="inp w-full h-20 py-2" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you check, and why this outcome?" />
              </Field>
              <Button disabled={note.trim().length < 10 || busy} onClick={submit}>{busy ? "Saving…" : "Record"}</Button>
              {err && <p className="text-xs text-loss">{err}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Screening() {
  const { alerts } = useStore();
  const hits = alerts.filter((a) => a.hit).map((a) => ({ ...a.hit!, status: a.status, businessName: a.businessName }));
  return (
    <Card>
      <CardHead title="Screening hits" />
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>List</th><th>Subject</th><th>Matched name</th><th className="text-right">Match</th><th>Category</th><th>Source</th><th>Date</th></tr></thead>
          <tbody>
            {hits.map((h) => (
              <tr key={h.id} className="cursor-pointer" onClick={() => go(`applications/${h.subject.businessId}`)}>
                <td>{LIST_LABEL[h.list]}</td>
                <td><div className="font-medium">{h.subject.name}</div><div className="text-[11px] text-muted-foreground">{h.subject.kind === "business" ? "Business" : `Owner of ${h.businessName}`}</div></td>
                <td className="text-muted-foreground">{h.matchedName}</td>
                <td className="text-right">{h.matchScore}%</td>
                <td className="text-muted-foreground">{h.category}</td>
                <td className="text-muted-foreground">{h.source}</td>
                <td className="text-muted-foreground">{d8(h.publishedOn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function Connectors() {
  return (
    <Card>
      <CardHead title="Screening connectors" />
      <ul className="px-5 pb-4">
        {CONNECTORS.map((c) => (
          <li key={c.id} className="flex items-center gap-4 py-3 border-t border-[hsl(var(--glass-line))] first:border-t-0 text-[13px]">
            <span className={cn("h-1.5 w-1.5 rounded-full", c.status === "connected" ? "bg-gain" : "bg-muted-foreground/40")} />
            <span className="font-medium">{c.name}</span>
            <span className="text-muted-foreground">{c.covers.map((l) => LIST_LABEL[l]).join(" · ")}</span>
            <span className="ml-auto text-[12px] text-muted-foreground">{c.status === "connected" ? "Connected" : "Not connected"}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
