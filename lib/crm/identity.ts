import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatPhone, isPlausiblePhone, phoneDigits } from "@/lib/business/phone";

/**
 * One customer, however they reach the business.
 *
 * A person arrives with a handle — a phone number, an email address, a
 * browser — and the same handle is the same customer on every channel. Each
 * handle a customer has been seen with is kept (`customer_identities`), and
 * marked **verified** (they called or wrote from it, the business's own system
 * said so, a person on the team confirmed it) or **stated** (someone said it).
 *
 * The rules, in docs/CUSTOMER-PROFILES.md:
 *   - the same handle is the same customer;
 *   - an anonymous conversation that learns a handle joins that customer;
 *   - a record made moments ago in the same conversation, with nothing of its
 *     own, folds into the customer it turned out to be;
 *   - two real customers are never merged on a claim: a "possibly the same
 *     person" match is recorded for the team;
 *   - a stated handle never becomes the address on file (`customers.phone`,
 *     `customers.email`), which is where order details and callbacks go.
 *
 * The browser is kept on `visitors.customer_id`, not here: one browser, the
 * person last identified in it.
 */

export type HandleKind = "phone" | "email";
/** How a conversation knows who it is with. The first five are verified. */
export type IdentifiedBy = "caller_id" | "whatsapp" | "email" | "business" | "team" | "otp" | "browser" | "stated";
/** "otp": they entered a code sent to the number or email on file (lib/verify/codes.ts). */
const VERIFIED_BY = new Set<string>(["caller_id", "whatsapp", "email", "business", "team", "otp"]);
export const isVerified = (by: string | null | undefined) => Boolean(by && VERIFIED_BY.has(by));

/** Where a handle was learned. */
export type HandleSource = "call" | "whatsapp" | "email" | "chat" | "voice" | "business" | "team" | "earlier";

type Customer = typeof s.customers.$inferSelect;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A handle as it is stored and as it is shown, or null when it is not one. */
export function handle(kind: HandleKind, raw: string | null | undefined) {
  const v = raw?.trim();
  if (!v) return null;
  if (kind === "phone") return isPlausiblePhone(v) ? { kind, value: phoneDigits(v), display: formatPhone(v) } : null;
  const email = v.toLowerCase();
  return EMAIL.test(email) && email.length <= 160 ? { kind, value: email, display: email } : null;
}
type Handle = NonNullable<ReturnType<typeof handle>>;

/**
 * The customer a handle belongs to, with whether that is verified.
 *
 * Records made before handles were kept (or by a screen that writes the
 * columns directly) are found by their phone or email column, and the handle
 * is written down as it is found.
 */
export async function customerByHandle(brandId: string, h: Handle) {
  const [row] = await db
    .select({ customer: s.customers, identity: s.customerIdentities })
    .from(s.customerIdentities)
    .innerJoin(s.customers, eq(s.customers.id, s.customerIdentities.customerId))
    .where(and(eq(s.customerIdentities.brandId, brandId), eq(s.customerIdentities.kind, h.kind), eq(s.customerIdentities.value, h.value)))
    .limit(1);
  if (row) return { customer: row.customer, verified: row.identity.verified, identityId: row.identity.id };

  const [legacy] = await db
    .select()
    .from(s.customers)
    .where(
      and(
        eq(s.customers.brandId, brandId),
        h.kind === "phone"
          ? sql`regexp_replace(coalesce(${s.customers.phone}, ''), '\\D', '', 'g') in (${h.value}, ${h.value.slice(2)})`
          : sql`lower(${s.customers.email}) = ${h.value}`,
      ),
    )
    .orderBy(s.customers.createdAt)
    .limit(1);
  if (!legacy) return null;
  // On file before handles were kept: as trusted as the record itself.
  const kept = await keepHandle(legacy.id, brandId, h, { verified: true, source: "earlier" });
  return { customer: legacy, verified: true, identityId: kept.identityId };
}

/**
 * Write down that a customer has been seen with a handle.
 *
 * A handle already on another customer is not moved: that is two people, or
 * one person with two records, and it comes back as `belongsTo` so the caller
 * can record a match. Seeing a handle again never makes it verified — only
 * the business, the team, or the channel the record was made from can.
 */
export async function keepHandle(
  customerId: string,
  brandId: string,
  h: Handle,
  opts: { verified: boolean; source: HandleSource; conversationId?: string | null },
): Promise<{ identityId: string; belongsTo: string | null }> {
  const [row] = await db
    .insert(s.customerIdentities)
    .values({ brandId, customerId, kind: h.kind, value: h.value, display: h.display, verified: opts.verified, source: opts.source, conversationId: opts.conversationId ?? null })
    .onConflictDoUpdate({
      target: [s.customerIdentities.brandId, s.customerIdentities.kind, s.customerIdentities.value],
      set: {
        lastSeenAt: new Date(),
        // Only for the same customer: the WHERE below leaves another's handle untouched.
        verified: sql`customer_identities.verified or ${opts.verified}`,
      },
      setWhere: sql`customer_identities.customer_id = ${customerId}`,
    })
    .returning({ id: s.customerIdentities.id, customerId: s.customerIdentities.customerId });
  if (row) return { identityId: row.id, belongsTo: null };
  const [other] = await db
    .select({ id: s.customerIdentities.id, customerId: s.customerIdentities.customerId })
    .from(s.customerIdentities)
    .where(and(eq(s.customerIdentities.brandId, brandId), eq(s.customerIdentities.kind, h.kind), eq(s.customerIdentities.value, h.value)))
    .limit(1);
  return { identityId: other.id, belongsTo: other.customerId };
}

/** Fill the phone or email on file, only where it is empty. */
async function fillOnFile(customer: Customer, h: Handle): Promise<Customer> {
  const column = h.kind === "phone" ? "phone" : "email";
  if (customer[column]) return customer;
  const [row] = await db.update(s.customers).set({ [column]: h.display }).where(eq(s.customers.id, customer.id)).returning();
  return row ?? customer;
}

/** A new customer, with the handles they were found by. */
export async function createCustomer(
  brandId: string,
  opts: { name?: string | null; phone?: Handle | null; email?: Handle | null; segment: string; verified: boolean; source: HandleSource; conversationId?: string | null },
) {
  const name = opts.name?.trim() || opts.phone?.display || opts.email?.value.split("@")[0] || "Unknown";
  const [customer] = await db
    .insert(s.customers)
    .values({
      brandId,
      name: name.slice(0, 120),
      // A new record's own handles are its address on file, whoever said them:
      // there is nobody else's on it to protect.
      phone: opts.phone?.display ?? null,
      email: opts.email?.value ?? null,
      segment: opts.segment,
      customerSince: new Date(),
    })
    .returning();
  for (const h of [opts.phone, opts.email]) {
    if (h) await keepHandle(customer.id, brandId, h, { verified: opts.verified, source: opts.source, conversationId: opts.conversationId });
  }
  return customer;
}

/**
 * The customer for a handle that arrived with the conversation itself — the
 * number calling, the WhatsApp sender, the business's own record.
 *
 * Found if known, made if not. A verified channel makes a verified handle on a
 * new record; on a record that was made from this very handle, it confirms it.
 */
export async function customerForHandle(
  brandId: string,
  h: Handle,
  opts: { name?: string | null; segment?: string; verified: boolean; source: HandleSource; conversationId?: string | null },
) {
  const found = await customerByHandle(brandId, h);
  if (found) {
    let verified = found.verified;
    if (opts.verified && !verified && (await isFoundingHandle(found.customer, found.identityId))) {
      await db.update(s.customerIdentities).set({ verified: true, lastSeenAt: new Date() }).where(eq(s.customerIdentities.id, found.identityId));
      verified = true;
    } else {
      await db.update(s.customerIdentities).set({ lastSeenAt: new Date() }).where(eq(s.customerIdentities.id, found.identityId));
    }
    let customer = found.customer;
    // The business's own system is trusted to fill what is missing on file.
    if (opts.source === "business" || (opts.verified && verified)) customer = await fillOnFile(customer, h);
    return { customer, verified, created: false };
  }
  const customer = await createCustomer(brandId, {
    name: opts.name,
    [h.kind]: h,
    segment: opts.segment ?? (h.kind === "email" ? "Email" : "New caller"),
    verified: opts.verified,
    source: opts.source,
    conversationId: opts.conversationId,
  });
  return { customer, verified: opts.verified, created: true };
}

/**
 * The handle the record was made from. Whoever controls it *is* that record,
 * so a verified channel may confirm it — unlike a handle someone added later
 * by saying it, which a channel cannot vouch for.
 */
async function isFoundingHandle(customer: Customer, identityId: string) {
  const [first] = await db
    .select({ id: s.customerIdentities.id })
    .from(s.customerIdentities)
    .where(eq(s.customerIdentities.customerId, customer.id))
    .orderBy(s.customerIdentities.firstSeenAt)
    .limit(1);
  return first?.id === identityId;
}

/** Point a conversation at a customer, saying how we know. Never weakens a verified identity of the same customer. */
export async function attachConversation(conversationId: string, customerId: string, by: IdentifiedBy) {
  await db
    .update(s.conversations)
    .set({
      customerId,
      identifiedBy: sql`case when ${s.conversations.customerId} = ${customerId} and ${s.conversations.identifiedBy} in ('caller_id','whatsapp','email','business','team','otp') then ${s.conversations.identifiedBy} else ${by} end`,
    })
    .where(eq(s.conversations.id, conversationId));
  await linkVisitor(conversationId);
}

/** The browser a conversation came from now belongs to whoever it turned out to be. */
export async function linkVisitor(conversationId: string) {
  await db.execute(sql`
    UPDATE visitors SET customer_id = conversations.customer_id
    FROM conversations
    WHERE conversations.id = ${conversationId}
      AND visitors.id = conversations.visitor_id
      AND conversations.customer_id IS NOT NULL
      AND visitors.customer_id IS DISTINCT FROM conversations.customer_id`);
}

/**
 * A record this conversation made a moment ago, with nothing of its own: no
 * other conversation, no orders, no payments. Folding it into the customer it
 * turned out to be loses nothing.
 */
export async function isStandIn(customer: Customer, conversationId: string) {
  const [conv] = await db.select({ startedAt: s.conversations.startedAt }).from(s.conversations).where(eq(s.conversations.id, conversationId)).limit(1);
  if (!conv || customer.createdAt.getTime() < conv.startedAt.getTime() - 60_000) return false;
  const [counts] = await db
    .select({
      conversations: sql<number>`(select count(*)::int from conversations where customer_id = ${customer.id} and id <> ${conversationId})`,
      records: sql<number>`(select count(*)::int from customer_records where customer_id = ${customer.id})`,
      payments: sql<number>`(select count(*)::int from customer_payments where customer_id = ${customer.id})`,
    })
    .from(sql`(select 1) as one`);
  return counts.conversations === 0 && counts.records === 0 && counts.payments === 0;
}

/**
 * Record that two customers may be the same person, with why. Kept once per
 * pair; a new reason is added to it, and a pair the team dismissed stays
 * dismissed.
 */
export async function recordMatch(brandId: string, a: string, b: string, reason: string, conversationId?: string | null) {
  if (a === b) return;
  const [customerId, otherId] = a < b ? [a, b] : [b, a];
  await db
    .insert(s.customerMatches)
    .values({ brandId, customerId, otherId, reasons: [reason], conversationId: conversationId ?? null })
    .onConflictDoUpdate({
      target: [s.customerMatches.brandId, s.customerMatches.customerId, s.customerMatches.otherId],
      set: {
        reasons: sql`case when customer_matches.reasons ? ${reason} then customer_matches.reasons else customer_matches.reasons || ${JSON.stringify([reason])}::jsonb end`,
      },
    });
}

/**
 * Fold one customer into another: everything `from` has moves to `into`, and
 * `from` goes. One batch, so it all happens or none of it does.
 *
 * `claimed`: merged because someone in a conversation said so, not because a
 * person on the team decided. Then `from`'s handles arrive on `into` as
 * stated, and nothing of `from`'s becomes the address on file.
 */
export async function mergeCustomers(brandId: string, fromId: string, intoId: string, opts: { reason: string; by: string; claimed: boolean }) {
  if (fromId === intoId) throw new Error("That is the same customer.");
  const rows = await db.select().from(s.customers).where(and(eq(s.customers.brandId, brandId), inArray(s.customers.id, [fromId, intoId])));
  const from = rows.find((r) => r.id === fromId);
  const into = rows.find((r) => r.id === intoId);
  if (!from || !into) throw new Error("Both customers must belong to this business.");

  const unnamed = (n: string) => /^\+?[\d\s()-]{7,}$/.test(n.trim()) || /^(new|unknown) caller/i.test(n) || n === "Unknown";
  const fill: Partial<typeof s.customers.$inferInsert> = {
    ...(unnamed(into.name) && !unnamed(from.name) ? { name: from.name } : {}),
    ...(!into.location && from.location ? { location: from.location } : {}),
    ...(!into.externalRef && from.externalRef ? { externalRef: from.externalRef } : {}),
    ...(!into.ownerMembershipId && from.ownerMembershipId ? { ownerMembershipId: from.ownerMembershipId, owner: from.owner } : {}),
    ...(from.customerSince && (!into.customerSince || from.customerSince < into.customerSince) ? { customerSince: from.customerSince } : {}),
    // A person deciding it is one customer may bring the address on file across; a claim may not.
    ...(!opts.claimed && !into.phone && from.phone ? { phone: from.phone } : {}),
    ...(!opts.claimed && !into.email && from.email ? { email: from.email } : {}),
  };

  // What is about to move, by id, so the merge can be undone exactly.
  const idsOf = async (table: typeof s.conversations | typeof s.leads | typeof s.followUps | typeof s.customerRecords | typeof s.customerPayments | typeof s.smsMessages | typeof s.customerNotes | typeof s.visitors | typeof s.customerScores) =>
    (await db.select({ id: table.id }).from(table).where(eq(table.customerId, fromId))).map((r) => r.id);
  const [conversations, leads, followUps, records, payments, sms, notes, visitors, scores, consentRows, identityRows] = await Promise.all([
    idsOf(s.conversations),
    idsOf(s.leads),
    idsOf(s.followUps),
    idsOf(s.customerRecords),
    idsOf(s.customerPayments),
    idsOf(s.smsMessages),
    idsOf(s.customerNotes),
    idsOf(s.visitors),
    idsOf(s.customerScores),
    db.execute(sql`SELECT kind FROM customer_consents WHERE customer_id = ${fromId} AND kind NOT IN (SELECT kind FROM customer_consents WHERE customer_id = ${intoId})`),
    db.select({ id: s.customerIdentities.id, verified: s.customerIdentities.verified }).from(s.customerIdentities).where(eq(s.customerIdentities.customerId, fromId)),
  ]);
  const moved: s.MergeMoved = {
    conversations,
    leads,
    followUps,
    records,
    payments,
    sms,
    notes,
    visitors,
    scores,
    consents: (consentRows.rows as { kind: string }[]).map((r) => r.kind),
    identities: identityRows,
    filled: Object.fromEntries(Object.keys(fill).map((k) => [k, (into as Record<string, unknown>)[k] ?? null])),
  };
  await db.batch([
    // The external ref is unique per business: free it before `into` takes it.
    db.update(s.customers).set({ externalRef: null }).where(eq(s.customers.id, fromId)),
    db.update(s.conversations).set({ customerId: intoId }).where(eq(s.conversations.customerId, fromId)),
    db.update(s.leads).set({ customerId: intoId }).where(eq(s.leads.customerId, fromId)),
    db.update(s.followUps).set({ customerId: intoId }).where(eq(s.followUps.customerId, fromId)),
    db.update(s.customerRecords).set({ customerId: intoId }).where(eq(s.customerRecords.customerId, fromId)),
    db.update(s.customerPayments).set({ customerId: intoId }).where(eq(s.customerPayments.customerId, fromId)),
    db.update(s.smsMessages).set({ customerId: intoId }).where(eq(s.smsMessages.customerId, fromId)),
    db.update(s.customerNotes).set({ customerId: intoId }).where(eq(s.customerNotes.customerId, fromId)),
    db.update(s.visitors).set({ customerId: intoId }).where(eq(s.visitors.customerId, fromId)),
    db.update(s.customerScores).set({ customerId: intoId }).where(eq(s.customerScores.customerId, fromId)),
    db.execute(sql`UPDATE customer_consents SET customer_id = ${intoId}
      WHERE customer_id = ${fromId} AND kind NOT IN (SELECT kind FROM customer_consents WHERE customer_id = ${intoId})`),
    db
      .update(s.customerIdentities)
      .set(opts.claimed ? { customerId: intoId, verified: false } : { customerId: intoId })
      .where(eq(s.customerIdentities.customerId, fromId)),
    // Matches with a third customer carry over; the pair itself is settled.
    db.execute(sql`UPDATE customer_matches SET customer_id = least(${intoId}::uuid, other_id), other_id = greatest(${intoId}::uuid, other_id)
      WHERE customer_id = ${fromId} AND other_id <> ${intoId}
        AND NOT EXISTS (SELECT 1 FROM customer_matches m WHERE m.brand_id = customer_matches.brand_id
          AND m.customer_id = least(${intoId}::uuid, customer_matches.other_id) AND m.other_id = greatest(${intoId}::uuid, customer_matches.other_id))`),
    db.execute(sql`UPDATE customer_matches SET customer_id = least(${intoId}::uuid, customer_id), other_id = greatest(${intoId}::uuid, customer_id)
      WHERE other_id = ${fromId} AND customer_id <> ${intoId}
        AND NOT EXISTS (SELECT 1 FROM customer_matches m WHERE m.brand_id = customer_matches.brand_id
          AND m.customer_id = least(${intoId}::uuid, customer_matches.customer_id) AND m.other_id = greatest(${intoId}::uuid, customer_matches.customer_id))`),
    ...(Object.keys(fill).length ? [db.update(s.customers).set(fill).where(eq(s.customers.id, intoId))] : []),
    db.insert(s.customerMerges).values({ brandId, intoId, fromId, fromRecord: from, reason: opts.reason, by: opts.by, moved }),
    db.delete(s.customers).where(eq(s.customers.id, fromId)),
  ]);
  const { refreshProfile } = await import("./profile");
  await refreshProfile(intoId).catch((e) => console.error("[identity] profile after merge", (e as Error).message));
  return intoId;
}

/**
 * Undo a merge: the record that was folded in comes back, with its own id,
 * and everything that moved with it goes back to it — its conversations,
 * leads, follow-ups, orders, payments, texts, notes, browsers, consents and
 * numbers and emails (verified as they were). Whatever `into` took from it is
 * put back as it was, where nobody has changed it since. The two are then
 * marked "not the same person", so the match is not suggested again.
 *
 * Merges made before undo existed did not record what moved; for those, what
 * can be traced to the record's number and email goes back.
 */
export async function undoMerge(brandId: string, mergeId: string, by: string) {
  const [merge] = await db.select().from(s.customerMerges).where(and(eq(s.customerMerges.id, mergeId), eq(s.customerMerges.brandId, brandId))).limit(1);
  if (!merge) throw new Error("No such merge.");
  if (merge.undoneAt) throw new Error("This merge has already been undone.");
  if (!merge.intoId) throw new Error("The customer it was merged into no longer exists.");
  const [into] = await db.select().from(s.customers).where(eq(s.customers.id, merge.intoId)).limit(1);
  if (!into) throw new Error("The customer it was merged into no longer exists.");
  const [taken] = await db.select({ id: s.customers.id }).from(s.customers).where(eq(s.customers.id, merge.fromId)).limit(1);
  if (taken) throw new Error("That record already exists again.");

  const from = merge.fromRecord as Record<string, unknown>;
  const date = (v: unknown) => (v ? new Date(String(v)) : null);
  const exact = Boolean(merge.moved);
  const moved = merge.moved ?? (await traceMoved(into.id, from));

  // What `into` took from `from` goes back, unless someone has changed it since.
  const revert: Record<string, unknown> = {};
  for (const [field, before] of Object.entries(moved.filled)) {
    const now = (into as Record<string, unknown>)[field];
    const theirs = from[field];
    const same = field === "customerSince" ? date(now)?.getTime() === date(theirs)?.getTime() : now === theirs;
    if (same) revert[field] = field === "customerSince" ? date(before) : before;
  }
  // The external ref is unique per business: `from` gets it back only if `into` no longer holds it.
  const intoRefAfter = "externalRef" in revert ? revert.externalRef : into.externalRef;
  const fromRef = (from.externalRef as string | null) ?? null;

  const [a, b] = merge.fromId < into.id ? [merge.fromId, into.id] : [into.id, merge.fromId];
  const fromId = merge.fromId;
  await db.batch([
    db.update(s.customerMerges).set({ undoneAt: new Date(), undoneBy: by }).where(eq(s.customerMerges.id, mergeId)),
    ...(Object.keys(revert).length ? [db.update(s.customers).set(revert).where(eq(s.customers.id, into.id))] : []),
    db.insert(s.customers).values({
      id: fromId,
      brandId,
      externalRef: fromRef && fromRef !== intoRefAfter ? fromRef : null,
      name: String(from.name ?? "Unknown"),
      email: (from.email as string | null) ?? null,
      phone: (from.phone as string | null) ?? null,
      location: (from.location as string | null) ?? null,
      segment: (from.segment as string | null) ?? null,
      tier: (from.tier as string | null) ?? null,
      ownerMembershipId: (from.ownerMembershipId as string | null) ?? null,
      owner: (from.owner as string | null) ?? null,
      customerSince: date(from.customerSince),
      renewsAt: date(from.renewsAt),
      ltvPaise: Number(from.ltvPaise ?? 0),
      createdAt: date(from.createdAt) ?? new Date(),
    }),
    db.update(s.conversations).set({ customerId: fromId }).where(and(eq(s.conversations.customerId, into.id), inArray(s.conversations.id, nonEmpty(moved.conversations)))),
    db.update(s.leads).set({ customerId: fromId }).where(and(eq(s.leads.customerId, into.id), inArray(s.leads.id, nonEmpty(moved.leads)))),
    db.update(s.followUps).set({ customerId: fromId }).where(and(eq(s.followUps.customerId, into.id), inArray(s.followUps.id, nonEmpty(moved.followUps)))),
    db.update(s.customerRecords).set({ customerId: fromId }).where(and(eq(s.customerRecords.customerId, into.id), inArray(s.customerRecords.id, nonEmpty(moved.records)))),
    db.update(s.customerPayments).set({ customerId: fromId }).where(and(eq(s.customerPayments.customerId, into.id), inArray(s.customerPayments.id, nonEmpty(moved.payments)))),
    db.update(s.smsMessages).set({ customerId: fromId }).where(and(eq(s.smsMessages.customerId, into.id), inArray(s.smsMessages.id, nonEmpty(moved.sms)))),
    db.update(s.customerNotes).set({ customerId: fromId }).where(and(eq(s.customerNotes.customerId, into.id), inArray(s.customerNotes.id, nonEmpty(moved.notes)))),
    db.update(s.visitors).set({ customerId: fromId }).where(and(eq(s.visitors.customerId, into.id), inArray(s.visitors.id, nonEmpty(moved.visitors)))),
    db.update(s.customerScores).set({ customerId: fromId }).where(and(eq(s.customerScores.customerId, into.id), inArray(s.customerScores.id, nonEmpty(moved.scores)))),
    db.update(s.customerConsents).set({ customerId: fromId }).where(and(eq(s.customerConsents.customerId, into.id), inArray(s.customerConsents.kind, nonEmpty(moved.consents)))),
    ...moved.identities.map((h) =>
      db.update(s.customerIdentities).set({ customerId: fromId, verified: h.verified }).where(and(eq(s.customerIdentities.id, h.id), eq(s.customerIdentities.customerId, into.id))),
    ),
    // Two people after all: not suggested as one again.
    db
      .insert(s.customerMatches)
      .values({ brandId, customerId: a, otherId: b, reasons: [`Merged by ${merge.by}, then separated by ${by}`], status: "dismissed", decidedBy: by, decidedAt: new Date() })
      .onConflictDoUpdate({ target: [s.customerMatches.brandId, s.customerMatches.customerId, s.customerMatches.otherId], set: { status: "dismissed", decidedBy: by, decidedAt: new Date() } }),
  ]);

  // A number or email that went back must not stay on file on the other record.
  for (const kind of ["phone", "email"] as const) {
    const [current] = await db.select().from(s.customers).where(eq(s.customers.id, into.id)).limit(1);
    const h = handle(kind, current?.[kind]);
    if (!h) continue;
    const [still] = await db
      .select({ id: s.customerIdentities.id })
      .from(s.customerIdentities)
      .where(and(eq(s.customerIdentities.customerId, into.id), eq(s.customerIdentities.kind, kind), eq(s.customerIdentities.value, h.value)))
      .limit(1);
    if (!still) await db.update(s.customers).set({ [kind]: await otherOnFile(into.id, kind) }).where(eq(s.customers.id, into.id));
  }

  const { refreshProfile } = await import("./profile");
  for (const id of [into.id, fromId]) await refreshProfile(id).catch(() => null);
  return { restored: fromId, name: String(from.name ?? ""), exact, moved: { conversations: moved.conversations.length, leads: moved.leads.length, handles: moved.identities.length } };
}

/** `inArray` with nothing in it matches nothing. */
const nonEmpty = (list: string[]) => (list.length ? list : ["00000000-0000-0000-0000-000000000000"]);

/** Another of the customer's handles of this kind to keep on file, verified first. */
async function otherOnFile(customerId: string, kind: HandleKind) {
  const [next] = await db
    .select({ display: s.customerIdentities.display })
    .from(s.customerIdentities)
    .where(and(eq(s.customerIdentities.customerId, customerId), eq(s.customerIdentities.kind, kind), eq(s.customerIdentities.verified, true)))
    .orderBy(s.customerIdentities.firstSeenAt)
    .limit(1);
  return next?.display ?? null;
}

const uuidList = (ids: string[]) => sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `);

/**
 * For a merge made before undo existed: what on `into` can be traced to the
 * folded-in record's number and email — its handles, the conversations that
 * used them (captured, written from, WhatsApp'd from, or where they were
 * learned), the leads and follow-ups of those, and texts to its number.
 */
async function traceMoved(intoId: string, from: Record<string, unknown>): Promise<s.MergeMoved> {
  const phone = handle("phone", from.phone as string | null);
  const email = handle("email", from.email as string | null);
  const values = [phone?.value, email?.value].filter((v): v is string => Boolean(v));
  const identities = values.length
    ? await db
        .select({ id: s.customerIdentities.id, verified: s.customerIdentities.verified, conversationId: s.customerIdentities.conversationId })
        .from(s.customerIdentities)
        .where(and(eq(s.customerIdentities.customerId, intoId), inArray(s.customerIdentities.value, values)))
    : [];
  const digits = phone?.value ?? "-";
  const short = phone ? digits.slice(-10) : "-";
  const mail = email?.value ?? "-";
  const learnedIn = identities.map((i) => i.conversationId).filter((x): x is string => Boolean(x));
  const rowsOf = (r: { rows: unknown[] }) => r.rows.map((x) => (x as { id: string }).id);
  const conversations = rowsOf(
    await db.execute(sql`
      SELECT id FROM conversations c WHERE c.customer_id = ${intoId} AND (
        right(regexp_replace(coalesce(c.captured->>'phone', ''), '\\D', '', 'g'), 10) = ${short}
        OR lower(coalesce(c.captured->>'email', '')) = ${mail}
        OR coalesce(c.external_ref, '') LIKE ${`agent:wa-${digits}-%`}
        OR c.id IN (SELECT conversation_id FROM email_messages WHERE address = ${mail} AND conversation_id IS NOT NULL)
        ${learnedIn.length ? sql`OR c.id IN (${uuidList(learnedIn)})` : sql``}
      )`),
  );
  const inConvs = conversations.length ? sql`conversation_id IN (${uuidList(conversations)})` : sql`false`;
  const leads = rowsOf(
    await db.execute(sql`SELECT id FROM leads WHERE customer_id = ${intoId} AND (
      right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10) = ${short} OR lower(coalesce(email, '')) = ${mail} OR ${inConvs})`),
  );
  const inLeads = leads.length ? sql`lead_id IN (${uuidList(leads)})` : sql`false`;
  const followUps = rowsOf(await db.execute(sql`SELECT id FROM follow_ups WHERE customer_id = ${intoId} AND (${inConvs} OR ${inLeads})`));
  const payments = rowsOf(await db.execute(sql`SELECT id FROM customer_payments WHERE customer_id = ${intoId} AND ${inConvs}`));
  const sms = rowsOf(await db.execute(sql`SELECT id FROM sms_messages WHERE customer_id = ${intoId} AND right(regexp_replace("to", '\\D', '', 'g'), 10) = ${short}`));
  return {
    conversations,
    leads,
    followUps,
    records: [],
    payments,
    sms,
    notes: [],
    visitors: [],
    scores: [],
    consents: [],
    identities: identities.map((i) => ({ id: i.id, verified: i.verified })),
    filled: {},
  };
}

/**
 * Take a number or email off a customer — added by mistake, or someone
 * else's. If it was the one on file, another of theirs (verified) takes its
 * place, or none. The conversations it brought stay where they are; the next
 * time someone uses it, they are a new customer.
 */
export async function removeHandle(brandId: string, identityId: string) {
  const [h] = await db.select().from(s.customerIdentities).where(and(eq(s.customerIdentities.id, identityId), eq(s.customerIdentities.brandId, brandId))).limit(1);
  if (!h) throw new Error("No such number or email.");
  await db.delete(s.customerIdentities).where(eq(s.customerIdentities.id, identityId));
  const kind = h.kind as HandleKind;
  const [c] = await db.select().from(s.customers).where(eq(s.customers.id, h.customerId)).limit(1);
  if (c && handle(kind, c[kind])?.value === h.value) {
    await db.update(s.customers).set({ [kind]: await otherOnFile(h.customerId, kind) }).where(eq(s.customers.id, h.customerId));
  }
  const { refreshProfile } = await import("./profile");
  await refreshProfile(h.customerId).catch(() => null);
  return h;
}

/** Records merged into this customer, newest first, for "undo". */
export async function mergesInto(brandId: string, customerId: string) {
  return db
    .select()
    .from(s.customerMerges)
    .where(and(eq(s.customerMerges.brandId, brandId), eq(s.customerMerges.intoId, customerId)))
    .orderBy(sql`${s.customerMerges.at} desc`);
}

/** Open "possibly the same person" matches for a customer, with the other record. */
export async function matchesFor(brandId: string, customerId: string) {
  const rows = await db
    .select()
    .from(s.customerMatches)
    .where(
      and(
        eq(s.customerMatches.brandId, brandId),
        eq(s.customerMatches.status, "open"),
        or(eq(s.customerMatches.customerId, customerId), eq(s.customerMatches.otherId, customerId)),
      ),
    );
  if (rows.length === 0) return [];
  const otherIds = rows.map((r) => (r.customerId === customerId ? r.otherId : r.customerId));
  const others = await db.select().from(s.customers).where(inArray(s.customers.id, otherIds));
  return rows
    .map((r) => ({ match: r, other: others.find((o) => o.id === (r.customerId === customerId ? r.otherId : r.customerId))! }))
    .filter((m) => m.other);
}

/**
 * Someone in a conversation asked about an order (by its reference). It is
 * evidence, not identity — a husband asks about his wife's order — so an
 * anonymous conversation is filed under the order's customer for the team to
 * see, the browser is not tied to them, and a conversation already with a
 * different customer records a match.
 */
export async function noteReference(conversationId: string, orderCustomerId: string, reference: string | null) {
  const [conv] = await db
    .select({ brandId: s.conversations.brandId, customerId: s.conversations.customerId })
    .from(s.conversations)
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!conv || conv.customerId === orderCustomerId) return;
  if (!conv.customerId) {
    await db
      .update(s.conversations)
      .set({ customerId: orderCustomerId, identifiedBy: "stated" })
      .where(and(eq(s.conversations.id, conversationId), sql`${s.conversations.customerId} is null`));
    return;
  }
  await recordMatch(conv.brandId, conv.customerId, orderCustomerId, `Asked about ${reference ?? "an order"}, which is the other record's`, conversationId);
}

/** Every handle on a customer, verified first. */
export async function handlesOf(customerId: string) {
  return db
    .select()
    .from(s.customerIdentities)
    .where(eq(s.customerIdentities.customerId, customerId))
    .orderBy(sql`${s.customerIdentities.verified} desc`, s.customerIdentities.firstSeenAt);
}

/** Other customers of this business, besides `except`, that a handle points to — for "merge in by number or email". */
export async function customerForMerge(brandId: string, raw: string, except: string) {
  const h = handle(raw.includes("@") ? "email" : "phone", raw);
  if (!h) return null;
  const found = await customerByHandle(brandId, h);
  return found && found.customer.id !== except ? found.customer : null;
}
