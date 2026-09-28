import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set — run `vercel env pull`.");
}

/**
 * One HTTP-pooled client per process. Neon's serverless driver is the right
 * fit for Fluid Compute: no connection to hold open between requests.
 *
 * ── How this instance renders an interpolated column ──────────────────────
 *
 * Writing `${s.memberships.id}` inside a raw `sql` template does not always
 * produce a qualified reference. Measured by printing `.toSQL()` for each
 * position, and by putting the bare form to the database:
 *
 *   position                    renders     if it were bare
 *   .where(…)                   qualified   binds to the nearest table
 *   .orderBy(…)                 qualified   binds to the nearest table
 *   .select({ … }) projection   BARE        binds to the nearest table
 *   .onConflictDoUpdate.set     qualified   ERROR 42702, ambiguous
 *
 * Only one of those rows is dangerous, and it is not the one that renders
 * bare — it is the combination. In a projection the bare name resolves
 * silently: inside `from handoffs h` it becomes `h.id`, so
 * `h.accepted_by_membership_id = "id"` compares the wrong column, the query
 * succeeds, and what comes back is wrong numbers rather than no numbers. A
 * screen of confident zeros passes a browser check in a way an empty table
 * would not, which is exactly how it survived one here.
 *
 * The SET clause is the opposite case and worth knowing so nobody spends
 * effort guarding it: the target row and `excluded` are both in scope, so an
 * unqualified column is rejected outright rather than resolved to one of them
 * (`set n = n + 1` → `column reference "n" is ambiguous`). If drizzle's
 * behaviour ever moved there, the statement would die at the parser.
 *
 * So: **inside a raw `sql` template, write outer columns out in full**
 * (`memberships.id`), whatever position it is in today. A predicate written
 * for a `where` gets lifted into a projection eventually.
 *
 * `npm run check:sql` asserts these renderings and fails if drizzle's
 * behaviour changes under an upgrade. `lib/queries/scoping.ts` has the worked
 * example.
 */
export const db = drizzle(neon(process.env.DATABASE_URL), { schema, casing: "snake_case" });

export { schema };
