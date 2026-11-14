// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed
// Wipes the demo tables and loads the 500-business synthetic book with its audit history.
import { createClient } from "@supabase/supabase-js";
import { seed } from "../src/server/seed";
import { supabaseDb } from "../src/server/supabaseDb";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const client = createClient(url, key, { auth: { persistSession: false } });
const r = await seed(supabaseDb(client), (m) => console.log(m));
const { data } = await client.rpc("kredit_verify_audit");
console.log("Done:", r, "audit chain:", data);
