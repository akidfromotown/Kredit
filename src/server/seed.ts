// Loads the seeded demo world (500 applications under POL-1.0 plus analyst history) into a database.
import type { AuditInput } from "../engine/audit";
import type { Decision } from "../engine/decision";
import type { CreditPolicy } from "../engine/policy";
import type { Business } from "../engine/types";
import { seedWorld } from "../engine/world";

export interface SeedTarget {
  reset(): Promise<void>;
  insertPolicies(p: CreditPolicy[]): Promise<void>;
  insertBusinesses(b: Business[]): Promise<void>;
  insertDecisions(d: Decision[]): Promise<void>;
  appendAuditBatch(a: AuditInput[]): Promise<void>;
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function seed(t: SeedTarget, log: (m: string) => void = () => {}) {
  const { world, audit } = seedWorld();
  log("Resetting demo tables");
  await t.reset();
  await t.insertPolicies(world.policies);
  for (const c of chunks(world.businesses, 100)) await t.insertBusinesses(c);
  log(`Inserted ${world.businesses.length} businesses`);
  for (const c of chunks(Object.values(world.decisions), 100)) await t.insertDecisions(c);
  log(`Inserted ${Object.keys(world.decisions).length} decisions`);
  // order matters: the database chains each entry to the one before it
  for (const c of chunks(audit, 250)) await t.appendAuditBatch(c);
  log(`Appended ${audit.length} audit entries`);
  return { businesses: world.businesses.length, decisions: Object.keys(world.decisions).length, audit: audit.length };
}
