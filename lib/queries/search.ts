import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { latestScores } from "./scoring";

/**
 * Console search.
 *
 * Four things are worth finding from the top bar — a customer, a conversation,
 * a document, and a person — and each is looked up in its own small query
 * rather than through one union, because the columns that matter differ and
 * the result groups are shown separately anyway.
 *
 * Every query is scoped to the brand in view (or the org, for people) before
 * it is scoped by the term. Search is a common way to leak across a tenant
 * boundary, so the scope is a `where` clause, never a filter on the results.
 */

export type SearchHit = {
  kind: "customer" | "conversation" | "document" | "person";
  href: string;
  title: string;
  detail: string;
  aside?: string;
};

const like = (term: string) => `%${term.replace(/[%_]/g, (c) => `\\${c}`)}%`;

export async function search(
  { brandId, orgId }: { brandId: string; orgId: string },
  term: string,
  limitPerGroup = 6,
): Promise<{ customers: SearchHit[]; conversations: SearchHit[]; documents: SearchHit[]; people: SearchHit[]; total: number }> {
  const q = term.trim();
  if (q.length < 2) {
    return { customers: [], conversations: [], documents: [], people: [], total: 0 };
  }
  const pattern = like(q);

  const [customerRows, conversationRows, documentRows, peopleRows] = await Promise.all([
    db
      .select()
      .from(s.customers)
      .where(
        and(
          eq(s.customers.brandId, brandId),
          or(
            ilike(s.customers.name, pattern),
            ilike(s.customers.externalRef, pattern),
            ilike(s.customers.email, pattern),
            ilike(s.customers.phone, pattern),
            ilike(s.customers.location, pattern),
          ),
        ),
      )
      .limit(limitPerGroup),

    db
      .select({
        id: s.conversations.id,
        intent: s.conversations.intent,
        channel: s.conversations.channel,
        status: s.conversations.status,
        startedAt: s.conversations.startedAt,
        customerName: s.customers.name,
      })
      .from(s.conversations)
      .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
      .where(
        and(
          eq(s.conversations.brandId, brandId),
          or(
            ilike(s.conversations.intent, pattern),
            ilike(s.customers.name, pattern),
            // Reach into the transcript, so searching a phrase someone
            // remembers from a call actually finds that call.
            sql`exists (select 1 from ${s.turns} t where t.conversation_id = ${s.conversations.id} and t.body ilike ${pattern})`,
          ),
        ),
      )
      .orderBy(desc(s.conversations.startedAt))
      .limit(limitPerGroup),

    db
      .select()
      .from(s.documents)
      .where(
        and(
          eq(s.documents.brandId, brandId),
          or(
            ilike(s.documents.title, pattern),
            ilike(s.documents.collection, pattern),
            ilike(s.documents.body, pattern),
          ),
        ),
      )
      .orderBy(desc(s.documents.citationCount))
      .limit(limitPerGroup),

    db
      .select()
      .from(s.memberships)
      .where(
        and(
          eq(s.memberships.orgId, orgId),
          or(ilike(s.memberships.name, pattern), ilike(s.memberships.email, pattern)),
        ),
      )
      .limit(limitPerGroup),
  ]);

  const scores = await latestScores(customerRows.map((c) => c.id));

  const customers: SearchHit[] = customerRows.map((c) => ({
    kind: "customer",
    href: `/app/customers/${c.id}`,
    title: c.name,
    detail: [c.segment, c.tier, c.location].filter(Boolean).join(" · "),
    aside: scores.get(c.id) ? String(Math.round(scores.get(c.id)!.blended)) : undefined,
  }));

  const conversations: SearchHit[] = conversationRows.map((c) => ({
    kind: "conversation",
    href: `/app/conversations/${c.id}`,
    title: c.intent ?? "Untitled conversation",
    detail: [c.customerName, c.channel.replace("_", " ")].filter(Boolean).join(" · "),
    aside: c.startedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
  }));

  const documents: SearchHit[] = documentRows.map((d) => ({
    kind: "document",
    href: `/app/knowledge/${d.id}`,
    title: d.title,
    detail: `${d.collection} · ${d.kind}`,
    aside: d.citationCount ? `${d.citationCount} citations` : undefined,
  }));

  const people: SearchHit[] = peopleRows.map((m) => ({
    kind: "person",
    href: "/app/team",
    title: m.name,
    detail: `${m.role[0].toUpperCase()}${m.role.slice(1)} · ${m.email}`,
    aside: m.status === "invited" ? "Invited" : undefined,
  }));

  return {
    customers,
    conversations,
    documents,
    people,
    total: customers.length + conversations.length + documents.length + people.length,
  };
}

/** Counts for the empty state, so "no results" can say what there was to search. */
export async function searchScope(brandId: string, orgId: string) {
  const [[c], [v], [d], [p]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(s.customers).where(eq(s.customers.brandId, brandId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.conversations).where(eq(s.conversations.brandId, brandId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.documents).where(eq(s.documents.brandId, brandId)),
    db.select({ n: sql<number>`count(*)::int` }).from(s.memberships).where(eq(s.memberships.orgId, orgId)),
  ]);
  return { customers: c.n, conversations: v.n, documents: d.n, people: p.n };
}


