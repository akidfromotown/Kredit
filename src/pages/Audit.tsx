// Module 12: audit log.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Copy, ShieldCheck, ShieldX } from "lucide-react";
import { useStore } from "../store";
import type { AuditEntry, AuditType } from "../engine/audit";
import { Button, Card, Empty, PageHeader, Pill, Stat, TableWrap, dt, type Tone } from "../components/ui";

const TYPE_TONE: Record<AuditType, Tone> = {
  APPLICATION_SUBMITTED: "neutral", KYC_COMPLETED: "neutral", DECISION: "solid", REVIEW_RESOLVED: "warn", OVERRIDE: "loss",
  POLICY_PUBLISHED: "gain", AI_OUTPUT: "outline", FINCRIME_DISPOSITION: "warn", DEMO_RESET: "outline",
};

export function AuditList({ filter, limit = 200 }: { filter?: (e: AuditEntry) => boolean; limit?: number }) {
  const { world } = useStore();
  const [open, setOpen] = useState<number | null>(null);
  const [n, setN] = useState(limit);
  const rows = useMemo(() => [...world.audit].filter(filter ?? (() => true)).reverse(), [world.audit.length, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <Card><Empty>No audit entries.</Empty></Card>;
  return (
    <Card>
      <TableWrap>
        <table className="tbl">
          <thead><tr><th>#</th><th>Time (UTC)</th><th>Type</th><th>Actor</th><th>Ref</th><th>Summary</th><th>Hash</th></tr></thead>
          <tbody>
            {rows.slice(0, n).map((e) => (
              <Fragment key={e.seq}>
                <tr className="cursor-pointer" onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                  <td className="text-muted-foreground">{e.seq}</td>
                  <td>{dt(e.at)}</td>
                  <td><Pill tone={TYPE_TONE[e.type]}>{e.type.toLowerCase().replace(/_/g, " ")}</Pill></td>
                  <td>{e.actor}{e.actorType === "ai" && <Pill tone="warn" className="ml-1">AI</Pill>}</td>
                  <td className="font-mono text-xs">{e.ref}</td>
                  <td className="whitespace-normal min-w-[260px]">{e.summary}</td>
                  <td className="font-mono text-[10px] text-muted-foreground">{e.hash.slice(0, 10)}…</td>
                </tr>
                {open === e.seq && (
                  <tr>
                    <td colSpan={7} className="bg-muted/30">
                      <div className="text-[11px] text-muted-foreground mb-1 font-mono">prev {e.prevHash} → hash {e.hash}</div>
                      <pre className="text-[11px] leading-snug max-h-80 overflow-auto whitespace-pre-wrap">{JSON.stringify(e.payload, (_k, v) => (v === -Infinity ? "-Infinity" : v), 2)}</pre>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {rows.length > n && <div className="p-3 text-center"><button className="text-sm underline text-muted-foreground" onClick={() => setN(n + 300)}>Show more ({rows.length - n} older)</button></div>}
    </Card>
  );
}

export default function AuditPage() {
  const { world, reset, userActionCount, verifyAudit, mode } = useStore();
  const [type, setType] = useState<"all" | AuditType>("all");
  const [actor, setActor] = useState<"all" | "system" | "human" | "ai">("all");
  const [chain, setChain] = useState<{ ok: boolean; entries: number; brokenAt?: number } | null>(null);
  useEffect(() => {
    let live = true;
    verifyAudit().then((r) => live && setChain(r), () => live && setChain(null));
    return () => { live = false; };
  }, [world.audit.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const filter = useMemo(() => (e: AuditEntry) => (type === "all" || e.type === type) && (actor === "all" || e.actorType === actor), [type, actor]);
  const count = (t: AuditType) => world.audit.filter((e) => e.type === t).length;

  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const [confirmReset, setConfirmReset] = useState(false);
  const copyJson = () => {
    const text = JSON.stringify(world.audit, (_k, v) => (v === -Infinity ? "-Infinity" : v), 2);
    navigator.clipboard?.writeText(text).then(() => setCopied("ok"), () => setCopied("fail")) ?? setCopied("fail");
  };

  return (
    <div>
      <PageHeader
        title="Audit log"
        sub="Append-only record of every application, verification, decision, review, override, policy change and AI output. Each entry stores its full payload and the hash of the entry before it, so any edit breaks the chain."
        right={<div className="flex items-center gap-2">{copied && <span className="text-xs text-muted-foreground">{copied === "ok" ? "Copied to clipboard" : "Clipboard unavailable here"}</span>}<Button variant="outline" onClick={copyJson}><Copy className="h-4 w-4" />Copy as JSON</Button></div>}
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="p-4 flex flex-col">
          <div className="micro flex items-center h-4 gap-1.5">
            {!chain || chain.ok ? <ShieldCheck className={`h-3.5 w-3.5 ${chain ? "text-gain" : ""}`} /> : <ShieldX className="h-3.5 w-3.5 text-loss" />}
            <span className="truncate">{mode === "backend" ? "SHA-256 chain" : "Hash chain"}</span>
          </div>
          <div className={`num text-[30px] leading-none mt-3 whitespace-nowrap ${chain && !chain.ok ? "text-loss" : ""}`}>{!chain ? "…" : chain.ok ? "Intact" : `Broken #${chain.brokenAt}`}</div>
          {chain && <div className="text-[11px] text-muted-foreground mt-2">{chain.entries.toLocaleString()} entries</div>}
        </Card>
        <Stat label="Decisions" value={count("DECISION")} />
        <Stat label="Reviews resolved" value={count("REVIEW_RESOLVED")} />
        <Stat label="Overrides" value={count("OVERRIDE")} />
        <Stat label="AI outputs" value={count("AI_OUTPUT")} sub="advisory only" />
      </div>
      <div className="flex flex-wrap gap-2 items-center mb-3">
        <select className="inp" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          <option value="all">All types</option>
          {(Object.keys(TYPE_TONE) as AuditType[]).map((t) => <option key={t} value={t}>{t.toLowerCase().replace(/_/g, " ")}</option>)}
        </select>
        <select className="inp" value={actor} onChange={(e) => setActor(e.target.value as typeof actor)}>
          <option value="all">All actors</option><option value="system">System</option><option value="human">Human</option><option value="ai">AI</option>
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{mode === "backend" ? "Stored in the shared database; reset with the seed script." : `${userActionCount} action(s) by you in this browser.`}</span>
        {mode === "local" && userActionCount > 0 && !confirmReset && <Button variant="ghost" onClick={() => setConfirmReset(true)}>Reset demo</Button>}
        {confirmReset && (
          <span className="flex items-center gap-2 text-xs">
            Clear your policy versions, reviews, overrides, onboarded applicants and AI entries?
            <Button variant="danger" onClick={() => { reset(); setConfirmReset(false); }}>Reset</Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Cancel</Button>
          </span>
        )}
      </div>
      <AuditList key={type + actor} filter={filter} />
    </div>
  );
}
