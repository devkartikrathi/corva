/**
 * Asserts how this drizzle instance renders an interpolated column.
 *
 * There is a failure mode in `sql` templates that is invisible at the call
 * site: `${s.memberships.id}` is qualified in some positions and emitted as a
 * bare `"id"` in others. Where it is bare, Postgres binds it to whichever
 * table is nearest in scope, and the query runs and returns the wrong numbers.
 * It cost a whole screen of confident zeros here, and it survived a browser
 * pass because zeros look like data.
 *
 * The explanation lives in `lib/db/index.ts`. This is the part that fails if
 * someone reintroduces the shape, or if a drizzle upgrade moves the boundary —
 * a comment only works on the person who reads it first.
 *
 * Only positions with a *silent* failure mode are here. The `onConflictDoUpdate
 * .set` clause deliberately is not: the target row and `excluded` are both in
 * scope there, so an unqualified column is rejected as ambiguous rather than
 * resolved to the wrong one. Pinning it would assert something that can only
 * fail loudly, which is the same mistake as asserting a spelling.
 *
 * No database is touched: `.toSQL()` renders without connecting.
 *
 *   npm run check:sql
 */
import "../lib/db/script-env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";
import { conversationIsTheirs, customerIsTheirs } from "../lib/queries/scoping";

const UUID = "00000000-0000-0000-0000-000000000000";

type Case = {
  what: string;
  sql: string;
  /**
   * The correlation the query depends on, as a pattern rather than a literal.
   *
   * `customers.id` and `"customers"."id"` are both correct and drizzle emits
   * one or the other depending on position — asserting the exact spelling
   * would fail on a safe edit, and a check that cries wolf gets deleted. What
   * matters is only ever *which table* the bare name would have bound to.
   */
  expect: RegExp;
  /** The bare form, which binds to whichever table is nearest in scope. */
  reject: RegExp;
};

const cases: Case[] = [
  {
    what: "where — a correlated subquery over another table",
    sql: db
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(
        sql`(select max(created_at) from ${s.turns} where conversation_id = ${s.conversations.id}) > now()`,
      )
      .toSQL().sql,
    expect: /conversation_id = "?conversations"?\."?id"?/,
    reject: /conversation_id = "id"/,
  },
  {
    what: "where — a correlated subquery over the same table, aliased",
    sql: db
      .select({ id: s.customerScores.id })
      .from(s.customerScores)
      .where(
        sql`${s.customerScores.computedAt} = (
          select max(cs.computed_at) from ${s.customerScores} cs
          where cs.customer_id = ${s.customerScores.customerId}
        )`,
      )
      .toSQL().sql,
    expect: /cs\.customer_id = "?customer_scores"?\."?customer_id"?/,
    reject: /cs\.customer_id = "customer_id"/,
  },
  {
    /**
     * The one that bites. Drizzle does NOT qualify here, so the outer column
     * is written out in full — this asserts the workaround is still in place,
     * not that drizzle has been fixed.
     */
    what: "select projection — outer column written out in full",
    sql: db
      .select({
        name: s.memberships.name,
        open: sql<number>`(
          select count(*)::int from ${s.handoffs} h
          where h.routed_to_membership_id = memberships.id
        )`,
      })
      .from(s.memberships)
      .toSQL().sql,
    expect: /h\.routed_to_membership_id = "?memberships"?\."?id"?/,
    reject: /h\.routed_to_membership_id = "id"/,
  },
  {
    what: "scoping.ts — customerIsTheirs correlates on customers, not conversations",
    sql: db
      .select({ id: s.customers.id })
      .from(s.customers)
      .where(and(eq(s.customers.brandId, UUID), customerIsTheirs(UUID)))
      .toSQL().sql,
    expect: /c\.customer_id = "?customers"?\."?id"?/,
    reject: /c\.customer_id = "id"/,
  },
  {
    what: "scoping.ts — conversationIsTheirs correlates on conversations",
    sql: db
      .select({ id: s.conversations.id })
      .from(s.conversations)
      .where(and(inArray(s.conversations.status, ["live"]), conversationIsTheirs(UUID)))
      .toSQL().sql,
    expect: /cu\.id = "?conversations"?\."?customer_id"?/,
    reject: /cu\.id = "customer_id"/,
  },
];

function main() {
  const failures: string[] = [];

  for (const c of cases) {
    const rendered = c.sql.replace(/\s+/g, " ");
    // Order matters: the bare form is the actual defect, so it is reported as
    // itself rather than as "the correlation is missing".
    if (c.reject.test(rendered)) {
      failures.push(
        `${c.what}\n    binds to the wrong table: ${c.reject.source}\n    rendered: ${rendered}`,
      );
      continue;
    }
    if (!c.expect.test(rendered)) {
      failures.push(
        `${c.what}\n    lost the correlation: ${c.expect.source}\n    rendered: ${rendered}`,
      );
      continue;
    }
    console.log(`  ok  ${c.what}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} of ${cases.length} failed:\n`);
    for (const f of failures) console.error(`  ✗ ${f}\n`);
    console.error("See the note on `db` in lib/db/index.ts before changing these.\n");
    process.exit(1);
  }

  console.log(`\n${cases.length} column renderings hold.`);
}

main();
