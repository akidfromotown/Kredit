// Supabase Edge Function: the single write path for Kredit.
// Engine and handler code is bundled from src/server by `npm run build:server` into ../_shared/kredit-server.js.
import { createClient } from "npm:@supabase/supabase-js@2.87.1";
import { ValidationError, handle, supabaseDb } from "../_shared/kredit-server.js";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("KREDIT_ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }
  // Service role: writes go through the security-definer functions; RLS keeps everything else read-only.
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  try {
    return json(await handle(supabaseDb(client), body as never));
  } catch (e) {
    if (e instanceof ValidationError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: "Server error. Check the function logs." }, 500);
  }
});
