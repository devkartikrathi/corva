import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { customerForCaller, isUnnamed } from "@/lib/crm/capture";
import { ApiError } from "./api";

/**
 * A business's own records, mirrored so the assistant can answer from them.
 *
 * Corva takes the booking; what happens next — the order collected, cleaned,
 * out for delivery — happens in the business's own system. When the customer
 * comes back and asks "where is my order?", the assistant has to know. So the
 * business sends each record's current state here (POST /api/v1/records, on
 * every change), keyed by the reference the customer was given, and the
 * assistant looks it up by that reference in chat and on calls.
 *
 * Corva does not own these and never changes them: the latest state sent is
 * the state. `status` is said to the customer as it is, so it should be a
 * sentence the business would be happy to hear read out.
 */

type Brand = typeof s.brands.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["order", "booking", "delivery", "ticket", "invoice", "subscription"];

const clip = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** "td 7k3qx9", "TD-7K3QX9" and "T D dash 7 K 3 Q X 9" are the same reference. */
export const referenceKey = (ref: string) =>
  ref
    .toUpperCase()
    .replace(/\b(DASH|HYPHEN|MINUS)\b/g, "")
    .replace(/[^A-Z0-9]/g, "");

const refKeySql = sql`regexp_replace(upper(${s.customerRecords.ref}), '[^A-Z0-9]', '', 'g')`;

export type RecordInput = {
  kind?: unknown;
  reference?: unknown;
  label?: unknown;
  status?: unknown;
  amountRupees?: unknown;
  occurredAt?: unknown;
  leadId?: unknown;
  customer?: { id?: unknown; phone?: unknown; name?: unknown; email?: unknown };
  meta?: unknown;
};

function recordJson(r: typeof s.customerRecords.$inferSelect) {
  return {
    id: r.id,
    kind: r.kind,
    reference: r.ref,
    label: r.label,
    status: r.status,
    amountRupees: r.amountPaise != null ? r.amountPaise / 100 : null,
    customerId: r.customerId,
    occurredAt: r.occurredAt.toISOString(),
    meta: r.meta ?? {},
  };
}

/** Whose record it is: a customer id, the lead it grew out of, or a phone number. */
async function customerFor(brand: Brand, input: RecordInput) {
  const c = input.customer ?? {};
  if (typeof c.id === "string" && UUID.test(c.id)) {
    const [row] = await db.select().from(s.customers).where(and(eq(s.customers.id, c.id), eq(s.customers.brandId, brand.id))).limit(1);
    if (row) return row;
  }
  if (typeof input.leadId === "string" && UUID.test(input.leadId)) {
    const [row] = await db
      .select({ customer: s.customers })
      .from(s.leads)
      .innerJoin(s.customers, eq(s.customers.id, s.leads.customerId))
      .where(and(eq(s.leads.id, input.leadId), eq(s.leads.brandId, brand.id)))
      .limit(1);
    if (row) return row.customer;
  }
  const phone = clip(c.phone, 30);
  if (phone) {
    let customer = (await customerForCaller(brand.id, phone))!;
    const name = clip(c.name, 120);
    const email = clip(c.email, 160);
    const updates: Partial<typeof s.customers.$inferInsert> = {};
    if (name && isUnnamed(customer.name)) updates.name = name;
    if (email && !customer.email) updates.email = email;
    if (Object.keys(updates).length) [customer] = await db.update(s.customers).set(updates).where(eq(s.customers.id, customer.id)).returning();
    return customer;
  }
  throw new ApiError(400, "A record needs a customer: send customer.id, leadId or customer.phone.");
}

/**
 * POST /api/v1/records — the current state of one record. Sent again whenever
 * it changes; the same `kind` and `reference` replace what was there.
 */
export async function upsertRecord(brand: Brand, input: RecordInput) {
  const kind = clip(input.kind, 20)?.toLowerCase() ?? "order";
  if (!KINDS.includes(kind)) throw new ApiError(400, `kind must be one of: ${KINDS.join(", ")}.`);
  const reference = clip(input.reference, 40);
  if (!reference || referenceKey(reference).length < 3) throw new ApiError(400, "reference is required — the id the customer was given.");
  const label = clip(input.label, 200);
  if (!label) throw new ApiError(400, "label is required — what the record is, in a few words.");

  let amountPaise: number | null = null;
  if (input.amountRupees != null) {
    const v = Number(input.amountRupees);
    if (!Number.isFinite(v) || v < 0) throw new ApiError(400, "amountRupees must be a number.");
    amountPaise = Math.round(v * 100);
  }
  let occurredAt: Date | undefined;
  if (input.occurredAt != null) {
    occurredAt = new Date(String(input.occurredAt));
    if (isNaN(occurredAt.getTime())) throw new ApiError(400, "occurredAt is not a valid date — use ISO 8601.");
  }
  const meta = input.meta && typeof input.meta === "object" && !Array.isArray(input.meta) ? (input.meta as Record<string, unknown>) : {};
  if (JSON.stringify(meta).length > 8000) throw new ApiError(400, "meta is too long.");

  const customer = await customerFor(brand, input);
  const values = { customerId: customer.id, kind, ref: reference, label, status: clip(input.status, 500) ?? null, amountPaise, sourceSystem: "api", meta };

  // Found within this business only: two businesses may well share a reference.
  const [existing] = await db
    .select({ id: s.customerRecords.id })
    .from(s.customerRecords)
    .innerJoin(s.customers, eq(s.customers.id, s.customerRecords.customerId))
    .where(and(eq(s.customers.brandId, brand.id), eq(s.customerRecords.kind, kind), sql`${refKeySql} = ${referenceKey(reference)}`))
    .limit(1);
  const [row] = existing
    ? await db
        .update(s.customerRecords)
        .set({ ...values, ...(occurredAt ? { occurredAt } : {}) })
        .where(eq(s.customerRecords.id, existing.id))
        .returning()
    : await db
        .insert(s.customerRecords)
        .values({ ...values, ...(occurredAt ? { occurredAt } : {}) })
        .returning();
  return { record: recordJson(row), created: !existing };
}

/** The business's records under a reference, newest first. */
export async function recordsByReference(brandId: string, reference: string) {
  const key = referenceKey(reference);
  if (key.length < 3) return [];
  const rows = await db
    .select({ r: s.customerRecords })
    .from(s.customerRecords)
    .innerJoin(s.customers, eq(s.customers.id, s.customerRecords.customerId))
    .where(and(eq(s.customers.brandId, brandId), sql`${refKeySql} = ${key}`))
    .orderBy(desc(s.customerRecords.occurredAt))
    .limit(5);
  return rows.map((row) => row.r);
}

/** GET /api/v1/records?reference= — what Corva holds under a reference. */
export async function listRecords(brand: Brand, params: URLSearchParams) {
  const reference = params.get("reference");
  if (!reference) throw new ApiError(400, "reference is required.");
  return { records: (await recordsByReference(brand.id, reference)).map(recordJson) };
}

/**
 * What the assistant is told when a customer asks after a reference.
 *
 * The record's own words and nothing about whose it is: a reference is all
 * the caller has shown, so no name, phone number or address goes back.
 */
export async function lookUpForAssistant(brandId: string, reference: string, opts: { canCheckDatabase?: boolean } = {}) {
  const [record] = await recordsByReference(brandId, reference);
  if (!record) {
    return {
      found: false as const,
      // Not every order is sent to Corva. When the business's own records can be
      // read (look_up_data), they are the next place to look, not "not found".
      say: opts.canCheckDatabase
        ? "This reference is not among the records the business has sent to Corva. Check the business's own records now with look_up_data, using a lookup that takes the reference, before telling the customer anything."
        : "Nothing is recorded under that reference. Read it back to check it, and if it is right, offer a callback from the team. Do not guess a status.",
    };
  }
  const meta = { ...((record.meta ?? {}) as Record<string, unknown>) };
  for (const key of ["address", "phone", "email", "customer", "name"]) delete meta[key];
  return {
    found: true as const,
    kind: record.kind,
    reference: record.ref,
    what: record.label,
    status: record.status ?? "No status has been recorded yet.",
    details: meta,
  };
}

export const LOOK_UP_DESCRIPTION =
  "Look up where an order, booking or delivery has got to, by the reference the customer was given " +
  "(for example TD-7K3QX9). Call it whenever a customer asks about the status of something they " +
  "already have with the business. You may tell them what it returns — status, expected times — " +
  "in your own words. If it finds nothing, say so; never guess.";

/** The paragraph both the chat and the voice assistant are given about it. */
export const LOOK_UP_INSTRUCTIONS =
  "When a customer asks where their order, booking or delivery has got to, ask for their reference " +
  "if they have not given it, then call look_up_record with it. Tell them the status it returns in a " +
  "sentence or two, with any expected time. This is the one thing you may state that is not in the " +
  "sources. Times in the details are ISO date-times: say them as a time of day in India (IST). If " +
  "nothing is found, say so and offer a callback from the team. Never give a status from memory, " +
  "and never give out a name, phone number or address from a reference alone.";
