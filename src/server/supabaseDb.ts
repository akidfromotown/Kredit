// KreditDb and seed adapter over supabase-js. Used by the Edge Function (service role) and the seed script.
// Only the client's type is imported, so the Deno bundle carries no copy of supabase-js.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditEntry, AuditInput } from "../engine/audit";
import type { Decision } from "../engine/decision";
import type { CreditPolicy } from "../engine/policy";
import type { Business } from "../engine/types";
import type { KreditDb } from "./api";
import { auditJson, businessRow, decisionRow, policyRow, rowToAudit, rowToDecision, type AuditRow } from "./rows";
import type { SeedTarget } from "./seed";

const PAGE = 1000;

/** Reads every row of a table in pages (PostgREST caps responses at 1,000 rows by default). */
export async function fetchAll<T>(client: SupabaseClient, table: string, columns: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select(columns).order(order).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<AuditEntry[]> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return ((data ?? []) as AuditRow[]).map(rowToAudit);
}

export function supabaseDb(client: SupabaseClient): KreditDb & SeedTarget {
  return {
    async policies() {
      return (await fetchAll<{ body: CreditPolicy }>(client, "policies", "body", "published_at")).map((r) => r.body);
    },
    async business(id) {
      const { data, error } = await client.from("businesses").select("body").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data?.body as Business) ?? null;
    },
    async decisionForBusiness(businessId) {
      const { data, error } = await client.from("decisions").select("body, human").eq("business_id", businessId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? rowToDecision(data as { body: Decision; human: Decision["human"] | null }) : null;
    },
    async allBusinesses() {
      return (await fetchAll<{ body: Business }>(client, "businesses", "body", "id")).map((r) => r.body);
    },
    async allDecisions() {
      return (await fetchAll<{ body: Decision; human: Decision["human"] | null }>(client, "decisions", "body, human", "id")).map(rowToDecision);
    },
    recordApplication: (b: Business, d: Decision, audit: AuditInput[]) =>
      rpc(client, "kredit_record_application", { p_business: b, p_decision: d, p_audit: auditJson(audit) }),
    recordHuman: (decisionId, human, audit) => rpc(client, "kredit_record_human", { p_decision_id: decisionId, p_human: human, p_audit: auditJson(audit) }),
    publishPolicy: (p, audit) => rpc(client, "kredit_publish_policy", { p_policy: p, p_audit: auditJson(audit) }),
    appendAudit: (audit) => rpc(client, "kredit_append_audit", { p_entries: auditJson(audit) }),

    // seed target
    async reset() {
      const { error } = await client.rpc("kredit_admin_reset");
      if (error) throw new Error(`reset: ${error.message}`);
    },
    async insertPolicies(ps) {
      const { error } = await client.from("policies").insert(ps.map(policyRow));
      if (error) throw new Error(`policies: ${error.message}`);
    },
    async insertBusinesses(bs) {
      const { error } = await client.from("businesses").insert(bs.map(businessRow));
      if (error) throw new Error(`businesses: ${error.message}`);
    },
    async insertDecisions(ds) {
      const { error } = await client.from("decisions").insert(ds.map(decisionRow));
      if (error) throw new Error(`decisions: ${error.message}`);
    },
    async appendAuditBatch(a) {
      await rpc(client, "kredit_append_audit", { p_entries: auditJson(a) });
    },
  };
}
