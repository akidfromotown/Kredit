// Integration test: real migration + real server handler against local Postgres (Supabase roles emulated).
// Runs only when KREDIT_TEST_PG is set (`npm run test:db`).
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditInput } from "../engine/audit";
import type { Decision } from "../engine/decision";
import type { CreditPolicy } from "../engine/policy";
import { clonePolicy } from "../engine/policy";
import type { Business } from "../engine/types";
import { handle, ValidationError, type KreditDb } from "./api";
import { auditJson, businessRow, decisionRow, policyRow, rowToAudit, rowToDecision, type AuditRow } from "./rows";
import { seed, type SeedTarget } from "./seed";

const URL = process.env.KREDIT_TEST_PG;
const d = URL ? describe : describe.skip;

let pool: pg.Pool;

/** Runs a query as a given Supabase role, the way PostgREST would. */
async function as<T = Record<string, unknown>>(role: "service_role" | "anon", sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r.rows as T[];
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}

const svc = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => as<T>("service_role", sql, p);
const j = (v: unknown) => JSON.stringify(v);

function pgDb(): KreditDb & SeedTarget {
  const rpc = async (sql: string, p: unknown[]) => (await svc<AuditRow>(sql, p)).map(rowToAudit);
  const insert = async (table: string, rows: Record<string, unknown>[]) => {
    const cols = Object.keys(rows[0]);
    const vals: unknown[] = [];
    const tuples = rows.map((r, i) => `(${cols.map((c, k) => { vals.push(typeof r[c] === "object" && r[c] !== null ? j(r[c]) : r[c]); return `$${i * cols.length + k + 1}`; }).join(",")})`);
    await svc(`insert into public.${table} (${cols.join(",")}) values ${tuples.join(",")}`, vals);
  };
  return {
    policies: async () => (await svc<{ body: CreditPolicy }>("select body from public.policies order by published_at")).map((r) => r.body),
    business: async (id) => (await svc<{ body: Business }>("select body from public.businesses where id=$1", [id]))[0]?.body ?? null,
    decisionForBusiness: async (id) => {
      const r = (await svc<{ body: Decision; human: Decision["human"] | null }>("select body, human from public.decisions where business_id=$1", [id]))[0];
      return r ? rowToDecision(r) : null;
    },
    allBusinesses: async () => (await svc<{ body: Business }>("select body from public.businesses order by id")).map((r) => r.body),
    allDecisions: async () => (await svc<{ body: Decision; human: Decision["human"] | null }>("select body, human from public.decisions order by id")).map(rowToDecision),
    recordApplication: (b, dd, a) => rpc("select * from public.kredit_record_application($1,$2,$3)", [j(b), j(dd), j(auditJson(a))]),
    recordHuman: (id, h, a) => rpc("select * from public.kredit_record_human($1,$2,$3)", [id, j(h), j(auditJson(a))]),
    publishPolicy: (p, a) => rpc("select * from public.kredit_publish_policy($1,$2)", [j(p), j(auditJson(a))]),
    appendAudit: (a) => rpc("select * from public.kredit_append_audit($1)", [j(auditJson(a))]),
    reset: async () => { await svc("select public.kredit_admin_reset()"); },
    insertPolicies: (ps) => insert("policies", ps.map(policyRow)),
    insertBusinesses: (bs) => insert("businesses", bs.map(businessRow)),
    insertDecisions: (ds) => insert("decisions", ds.map(decisionRow)),
    appendAuditBatch: async (a: AuditInput[]) => { await svc("select * from public.kredit_append_audit($1)", [j(auditJson(a))]); },
  };
}

const verify = async () => (await as<{ ok: boolean; entries: string; broken_at: string | null }>("anon", "select * from public.kredit_verify_audit()"))[0];

d("Supabase schema + kredit-api", () => {
  let db: ReturnType<typeof pgDb>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL, max: 4 });
    db = pgDb();
    await seed(db);
  }, 120_000);
  afterAll(async () => { await pool?.end(); });

  it("seeds 500 businesses, their decisions and an intact SHA-256 audit chain", async () => {
    const [c] = await svc<{ b: string; d: string; a: string }>("select (select count(*) from businesses) b, (select count(*) from decisions) d, (select count(*) from audit_log) a");
    expect(Number(c.b)).toBe(500);
    expect(Number(c.d)).toBe(500);
    const v = await verify();
    expect(v.ok).toBe(true);
    expect(Number(v.entries)).toBe(Number(c.a));
    const [last] = await svc<{ hash: string }>("select hash from audit_log order by seq desc limit 1");
    expect(last.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("anon can read but cannot write, update or delete", async () => {
    expect((await as("anon", "select id from businesses limit 1")).length).toBe(1);
    await expect(as("anon", "delete from audit_log")).rejects.toThrow(/permission denied/);
    await expect(as("anon", "update decisions set human = '{}'::jsonb")).rejects.toThrow(/permission denied/);
    await expect(as("anon", "select public.kredit_admin_reset()")).rejects.toThrow(/permission denied/);
    await expect(as("anon", `select * from public.kredit_append_audit('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
  });

  it("the audit log rejects updates and deletes even for the service role", async () => {
    await expect(svc("update audit_log set summary = 'x' where seq = 1")).rejects.toThrow(/append-only/);
    await expect(svc("delete from audit_log where seq = 1")).rejects.toThrow(/append-only/);
    await expect(svc("truncate audit_log")).rejects.toThrow(/append-only/);
  });

  it("verification catches tampering done behind the triggers", async () => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local session_replication_role = replica"); // superuser bypass of triggers
      await c.query("update audit_log set summary = summary || ' (edited)' where seq = 10");
      const r = await c.query("select * from public.kredit_verify_audit()");
      expect(r.rows[0]).toMatchObject({ ok: false, broken_at: "10" });
      await c.query("rollback");
    } finally {
      c.release();
    }
    expect((await verify()).ok).toBe(true);
  });

  it("onboards an applicant: server decides, stores the decision and chains three audit entries", async () => {
    const r = await handle(db, {
      op: "onboard",
      input: { name: "Test Roasters LLC", industry: "Restaurant", state: "CA", entityType: "LLC", monthsInBusiness: 48, ownerName: "Sam Lee", ownerCreditScore: 720, requestedAmount: 60000, requestedTermMonths: 12, purpose: "Equipment", statedAnnualRevenue: 700000, bankProfile: "strong", kycScenario: "clean" },
    });
    expect(r.decision?.policyVersion).toBe("POL-1.0");
    expect(r.audit.map((a) => a.type)).toEqual(["APPLICATION_SUBMITTED", "KYC_COMPLETED", "DECISION"]);
    expect(r.audit[1].prevHash).toBe(r.audit[0].hash);
    const stored = await db.decisionForBusiness(r.business!.id);
    expect(stored?.score).toBe(r.decision?.score);
  });

  it("enforces human-action rules on the server", async () => {
    const all = await db.allDecisions();
    const pending = all.find((x) => x.engineOutcome === "REVIEW" && !x.human)!;
    await expect(handle(db, { op: "human", businessId: pending.businessId, action: "DECLINE", note: "Thin cash flow after review.", reasonCodes: [] })).rejects.toThrow(ValidationError);
    await expect(handle(db, { op: "human", businessId: pending.businessId, action: "APPROVE", note: "short" })).rejects.toThrow(/justification/);
    await expect(handle(db, { op: "human", businessId: pending.businessId, action: "APPROVE", note: "Mitigants verified with fresh statements.", amount: 1 })).rejects.toThrow(/Amount must be between/);
    const ok = await handle(db, { op: "human", businessId: pending.businessId, action: "APPROVE", note: "Mitigants verified with fresh statements." });
    expect(ok.decision?.human?.offer?.amount).toBe(pending.offer?.amount);
  }, 30_000);
});

d("Supabase schema + kredit-api (writes)", () => {
  let db: ReturnType<typeof pgDb>;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL, max: 4 });
    db = pgDb();
    await seed(db);
  }, 120_000);
  afterAll(async () => { await pool?.end(); });

  it("records a review once; a second action on the same decision is refused", async () => {
    const pending = (await db.allDecisions()).find((x) => x.engineOutcome === "REVIEW" && !x.human)!;
    const r = await handle(db, { op: "human", businessId: pending.businessId, action: "DECLINE", note: "Cash flow cannot support the payment.", reasonCodes: ["HUM-CASH"] });
    expect(r.audit[0].type).toBe("REVIEW_RESOLVED");
    expect(r.decision?.human?.reasons[0].code).toBe("HUM-CASH");
    await expect(handle(db, { op: "human", businessId: pending.businessId, action: "APPROVE", note: "Trying to flip it afterwards." })).rejects.toThrow(/already has a human action/);
    await expect(svc("update decisions set human = null where id = $1", [pending.id])).rejects.toThrow(/already has a human action/);
  });

  it("KYC failures cannot be overridden to approve", async () => {
    const kycFail = (await db.allDecisions()).find((x) => x.kycOutcome === "fail" && !x.human)!;
    await expect(handle(db, { op: "human", businessId: kycFail.businessId, action: "APPROVE", note: "Customer is known to us personally." })).rejects.toThrow(/cannot be approved/);
  });

  it("publishes a new policy version with server-assigned version and author; new decisions use it", async () => {
    const active = (await db.policies()).at(-1)!;
    const draft = clonePolicy(active);
    draft.scorecard.approveCutoff = 510;
    draft.version = "POL-9.9"; // ignored by the server
    await expect(handle(db, { op: "publish", policy: clonePolicy(active), note: "No change" })).rejects.toThrow(/no changes/);
    const r = await handle(db, { op: "publish", policy: draft, note: "Tighten auto-approve cutoff." });
    expect(r.policy?.version).toBe("POL-1.1");
    expect(r.audit[0].type).toBe("POLICY_PUBLISHED");
    const o = await handle(db, { op: "onboard", input: { name: "After Policy Co", industry: "Retail store", state: "TX", entityType: "LLC", monthsInBusiness: 30, ownerName: "Kim Park", ownerCreditScore: 690, requestedAmount: 40000, requestedTermMonths: 12, purpose: "Inventory", statedAnnualRevenue: 500000, bankProfile: "average", kycScenario: "clean" } });
    expect(o.decision?.policyVersion).toBe("POL-1.1");
  });

  it("logs AI output as advisory and refuses decline letters for non-declined files", async () => {
    const approved = (await db.allDecisions()).find((x) => x.engineOutcome === "APPROVE" && !x.human)!;
    await expect(handle(db, { op: "ai", task: "explain_decline", businessId: approved.businessId })).rejects.toThrow(/Only declined/);
    const r = await handle(db, { op: "ai", task: "credit_memo", businessId: approved.businessId });
    expect(r.audit[0]).toMatchObject({ type: "AI_OUTPUT", actorType: "ai" });
    const w = await handle(db, { op: "ai", task: "summarize_warnings" });
    expect(w.ai?.body).toMatch(/open accounts/);
    expect((await verify()).ok).toBe(true);
  }, 30_000);
});
