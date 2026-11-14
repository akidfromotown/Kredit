// Backend mode: reads come straight from Supabase (public, read-only via RLS); every write goes
// through the kredit-api Edge Function. Enabled when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Decision } from "../engine/decision";
import type { CreditPolicy } from "../engine/policy";
import type { Business } from "../engine/types";
import type { World } from "../engine/world";
import type { ApiRequest, ApiResponse } from "../server/api";
import { rowToAudit, rowToDecision, type AuditRow } from "../server/rows";
import { fetchAll } from "../server/supabaseDb";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const backendEnabled = Boolean(url && anonKey);

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!client) client = createClient(url!, anonKey!, { auth: { persistSession: false } });
  return client;
}

export async function loadRemoteWorld(): Promise<World> {
  const c = sb();
  const [policies, businesses, decisions, audit] = await Promise.all([
    fetchAll<{ body: CreditPolicy }>(c, "policies", "body", "published_at"),
    fetchAll<{ body: Business }>(c, "businesses", "body", "id"),
    fetchAll<{ body: Decision; human: Decision["human"] | null }>(c, "decisions", "body, human", "id"),
    fetchAll<AuditRow>(c, "audit_log", "*", "seq"),
  ]);
  if (!policies.length) throw new Error("The database is empty. Run `npm run seed` against this Supabase project.");
  const ds = decisions.map(rowToDecision);
  return {
    policies: policies.map((p) => p.body),
    businesses: businesses.map((b) => b.body),
    decisions: Object.fromEntries(ds.map((d) => [d.businessId, d])),
    audit: audit.map(rowToAudit),
  };
}

export async function callApi(req: ApiRequest): Promise<ApiResponse> {
  const { data, error } = await sb().functions.invoke("kredit-api", { body: req });
  if (error) {
    let message = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  return data as ApiResponse;
}

export async function verifyRemoteAudit(): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  const { data, error } = await sb().rpc("kredit_verify_audit");
  if (error) throw new Error(error.message);
  const r = (Array.isArray(data) ? data[0] : data) as { ok: boolean; entries: number; broken_at: number | null };
  return { ok: r.ok, entries: Number(r.entries), brokenAt: r.broken_at ?? undefined };
}
