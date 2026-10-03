import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { industryFor } from "./industries";
import { formatPhone, isPlausiblePhone } from "./phone";
import { identifyCustomer } from "@/lib/crm/capture";

/**
 * The details a business wants from every customer, and what was found out.
 *
 * Each business keeps its own list (Details to collect in the console):
 * Tumble Days wants a pickup address and what needs cleaning, a clinic would
 * want age and symptoms. The agent is told the list, asks for what it does
 * not have yet — naturally, not as a form — and records each answer the
 * moment it hears it, on chat and on calls alike. The answers live on the
 * conversation (for whoever takes the line mid-call) and on the lead (for
 * whoever works it afterwards).
 *
 * Name, phone and email are built in: they are also the customer record's own
 * columns, so every business has them and none can remove name or phone.
 */

export const FIELD_KINDS = ["text", "phone", "email", "address", "choice", "date", "number"] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export type IntakeField = {
  key: string;
  label: string;
  hint: string | null;
  kind: FieldKind;
  options: string[];
  required: boolean;
  builtIn: boolean;
};

export const BUILT_IN_FIELDS: IntakeField[] = [
  { key: "name", label: "Name", hint: null, kind: "text", options: [], required: true, builtIn: true },
  { key: "phone", label: "Phone number", hint: "A mobile number to reach them on", kind: "phone", options: [], required: true, builtIn: true },
  { key: "email", label: "Email", hint: "Where confirmations go", kind: "email", options: [], required: false, builtIn: true },
];

/** Built-ins that cannot be removed: a customer needs a name and a number. */
export const PERMANENT_KEYS = new Set(["name", "phone"]);

/** "Pickup address" → "pickup_address". Safe as a tool parameter name. */
export function fieldKey(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return !key ? "field" : /^[a-z]/.test(key) ? key : `f_${key}`;
}

const sentenceCase = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

/** What a new business starts with, from its industry template. */
export function defaultFields(industryKey: string | null | undefined): IntakeField[] {
  const industry = industryFor(industryKey);
  const own =
    industry.fields ??
    industry.leadQuestions
      .filter((q) => !/\b(name|number|phone|email)\b/i.test(q))
      .map((q) => ({ key: fieldKey(q), label: sentenceCase(q.replace(/^(their|a|an|the)\s+/i, "")) }));
  return [
    ...BUILT_IN_FIELDS,
    ...own.map(
      (f: { key: string; label: string; hint?: string; kind?: string; options?: string[]; required?: boolean }) => ({
        key: f.key,
        label: f.label,
        hint: f.hint ?? null,
        kind: (FIELD_KINDS as readonly string[]).includes(f.kind ?? "") ? (f.kind as FieldKind) : "text",
        options: f.options ?? [],
        required: f.required ?? false,
        builtIn: false,
      }),
    ),
  ];
}

const toField = (r: typeof s.intakeFields.$inferSelect): IntakeField => ({
  key: r.key,
  label: r.label,
  hint: r.hint,
  kind: (FIELD_KINDS as readonly string[]).includes(r.kind) ? (r.kind as FieldKind) : "text",
  options: r.options ?? [],
  required: r.required,
  builtIn: r.builtIn,
});

/**
 * The business's list, in order. A business that has never set one gets its
 * industry's defaults, written down the first time they are asked for — so
 * every existing business has a list without a migration step.
 */
export async function intakeFieldsFor(brandId: string, industryKey?: string | null): Promise<IntakeField[]> {
  const read = () => db.select().from(s.intakeFields).where(eq(s.intakeFields.brandId, brandId)).orderBy(asc(s.intakeFields.position));
  let rows = await read();
  if (rows.length === 0) {
    let industry = industryKey;
    if (industry === undefined) {
      const [brand] = await db.select({ industry: s.brands.industry }).from(s.brands).where(eq(s.brands.id, brandId)).limit(1);
      industry = brand?.industry ?? null;
    }
    await db
      .insert(s.intakeFields)
      .values(defaultFields(industry).map((f, position) => ({ brandId, ...f, position })))
      .onConflictDoNothing();
    rows = await read();
  }
  return rows.map(toField);
}

/** Replace a business's list. Built-ins are kept whatever is sent. */
export async function saveIntakeFields(brandId: string, input: Omit<IntakeField, "builtIn">[]) {
  const seen = new Set<string>();
  const fields: IntakeField[] = [];
  for (const raw of input) {
    const label = String(raw.label ?? "").trim().slice(0, 60);
    if (!label) continue;
    const builtIn = BUILT_IN_FIELDS.find((b) => b.key === raw.key);
    const key = builtIn ? builtIn.key : raw.key && /^[a-z][a-z0-9_]{0,39}$/.test(raw.key) ? raw.key : fieldKey(label);
    if (seen.has(key)) throw new Error(`Two fields would both be called "${key}". Rename one.`);
    seen.add(key);
    const kind: FieldKind = builtIn ? builtIn.kind : (FIELD_KINDS as readonly string[]).includes(raw.kind) ? raw.kind : "text";
    const options = kind === "choice" ? [...new Set((raw.options ?? []).map((o) => String(o).trim().slice(0, 60)).filter(Boolean))].slice(0, 20) : [];
    if (kind === "choice" && options.length < 2) throw new Error(`"${label}" is a choice: give it at least two options.`);
    fields.push({
      key,
      label,
      hint: String(raw.hint ?? "").trim().slice(0, 200) || null,
      kind,
      options,
      required: key === "name" ? true : Boolean(raw.required),
      builtIn: Boolean(builtIn),
    });
  }
  for (const permanent of PERMANENT_KEYS) {
    if (!seen.has(permanent)) fields.unshift(BUILT_IN_FIELDS.find((b) => b.key === permanent)!);
  }
  if (fields.length > 25) throw new Error("Keep it to 25 fields at most — the AI asks for every one.");

  await db.delete(s.intakeFields).where(eq(s.intakeFields.brandId, brandId));
  await db.insert(s.intakeFields).values(fields.map((f, position) => ({ brandId, ...f, position })));
  return fields;
}

/* ─── Values ───────────────────────────────────────────────────────────── */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const squash = (t: string) => t.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

/** A value as the field wants it, or null when it is not one (a bad number). */
function normalise(field: IntakeField, raw: string): string | null {
  const value = raw.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!value) return null;
  if (field.kind === "phone") return isPlausiblePhone(value) ? formatPhone(value) : null;
  if (field.kind === "email") return EMAIL.test(value) ? value.toLowerCase() : null;
  if (field.kind === "choice") {
    // "dry cleaning" is "Dry-cleaning". Something not on the list is kept as
    // said rather than lost — the person reading it can decide.
    const match = field.options.find((o) => squash(o) === squash(value)) ?? field.options.find((o) => squash(value).includes(squash(o)));
    return match ?? value;
  }
  return value;
}

/** The values that belong to the business's fields, each as its field wants it. */
export function cleanDetails(fields: IntakeField[], input: Record<string, unknown>) {
  const clean: Record<string, string> = {};
  const rejected: string[] = [];
  for (const field of fields) {
    const raw = input[field.key];
    if (typeof raw !== "string" && typeof raw !== "number") continue;
    const value = normalise(field, String(raw));
    if (value === null) rejected.push(field.label);
    else clean[field.key] = value;
  }
  return { clean, rejected };
}

/**
 * Record what the agent just found out.
 *
 * Merged into the conversation's details (and the lead's, when there is one),
 * and onto the customer record where a column exists for it and is empty —
 * never overwriting a name or address the business already has.
 */
export async function captureDetails(
  conversationId: string,
  fields: IntakeField[],
  input: Record<string, unknown>,
  leadId?: string | null,
) {
  const { clean, rejected } = cleanDetails(fields, input);
  if (Object.keys(clean).length === 0) return { saved: [] as string[], rejected, captured: null };

  const json = JSON.stringify(clean);
  const [updated] = await db
    .update(s.conversations)
    .set({ captured: sql`${s.conversations.captured} || ${json}::jsonb` })
    .where(eq(s.conversations.id, conversationId))
    .returning({ brandId: s.conversations.brandId, customerId: s.conversations.customerId, captured: s.conversations.captured });

  // A name or a number is who they are: the conversation gets a customer now,
  // rather than staying "Unidentified" until they confirm a booking.
  let conversation = updated;
  if (updated && (clean.name || clean.phone || clean.email)) {
    const customer = await identifyCustomer({
      conversationId,
      brandId: updated.brandId,
      customerId: updated.customerId,
      name: clean.name,
      phone: clean.phone,
      email: clean.email,
    });
    conversation = { ...updated, customerId: customer?.id ?? updated.customerId };
  }

  await db
    .update(s.leads)
    .set({ details: sql`${s.leads.details} || ${json}::jsonb`, updatedAt: new Date() })
    .where(leadId ? eq(s.leads.id, leadId) : eq(s.leads.conversationId, conversationId));

  const address = fields.find((f) => f.kind === "address" && clean[f.key]);
  if (conversation?.customerId && (clean.email || address)) {
    await db.execute(sql`
      UPDATE ${s.customers}
      SET email = coalesce(email, ${clean.email ?? null}),
          location = coalesce(location, ${address ? clean[address.key] : null})
      WHERE id = ${conversation.customerId}
    `);
  }
  return { saved: Object.keys(clean), rejected, captured: conversation?.captured ?? clean };
}

/** Everything known for this conversation: its details, with the customer record filling gaps. */
export async function knownDetails(conversationId: string, fields: IntakeField[]): Promise<Record<string, string>> {
  const [row] = await db
    .select({ captured: s.conversations.captured, customer: s.customers })
    .from(s.conversations)
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!row) return {};
  const known: Record<string, string> = {};
  const c = row.customer;
  if (c) {
    // Named after their number means the name is not known.
    if (c.name && !/^\+?[\d\s()-]{7,}$/.test(c.name.trim()) && !/^(new|unknown) caller/i.test(c.name)) known.name = c.name;
    if (c.phone) known.phone = c.phone;
    if (c.email) known.email = c.email;
    const address = fields.find((f) => f.kind === "address");
    if (address && c.location) known[address.key] = c.location;
  }
  return { ...known, ...(row.captured ?? {}) };
}

/** One line per field, for a prompt or a tool description. */
function describe(field: IntakeField): string {
  const parts = [field.hint, field.kind === "choice" && field.options.length ? `one of: ${field.options.join(", ")}` : null].filter(Boolean);
  return `${field.label}${field.required ? " (required)" : ""}${parts.length ? ` — ${parts.join("; ")}` : ""}`;
}

/**
 * What the agent is told: the list, what it already has, what it still needs,
 * and how to record an answer.
 */
export function detailsInstructions(fields: IntakeField[], known: Record<string, string>, tool: string): string {
  const have = fields.filter((f) => known[f.key]);
  const need = fields.filter((f) => !known[f.key]);
  return [
    "Details to collect",
    "The team needs these from every customer. Find them out naturally over the conversation — a question or two at a time, never as a form — and never ask again for one you already have. Do not hold up an answer to collect them.",
    ...fields.map((f) => `- ${describe(f)}`),
    have.length ? `Already known: ${have.map((f) => `${f.label}: ${known[f.key]}`).join(" · ")}` : "Nothing is known yet.",
    need.length
      ? `Still needed: ${need.map((f) => f.label).join(", ")}${need.some((f) => f.required) ? " — the required ones first, once they have said what they want" : ""}.`
      : "You have everything.",
    `Whenever you learn one of these, record it with ${tool} straight away, using the field names it lists.`,
  ].join("\n");
}

/** The fields as tool parameters for the text agent (AI SDK). */
export function detailsSchema(fields: IntakeField[]) {
  return z.object(Object.fromEntries(fields.map((f) => [f.key, z.string().optional().describe(describe(f))])));
}

/** The same, for a Gemini Live function declaration. Built-ins excluded: that tool has its own. */
export function detailsLiveProperties(fields: IntakeField[]) {
  return Object.fromEntries(
    fields.filter((f) => !f.builtIn).map((f) => [f.key, { type: "STRING", description: describe(f) }]),
  );
}

/** The questions for a new caller, in the words the CRM instructions use. */
export const leadQuestionsFrom = (config: { fields: IntakeField[] }) =>
  config.fields.filter((f) => !f.builtIn || f.key === "name").map((f) => f.label.toLowerCase());

/** Labelled values, in the business's order, for a card or a screen. */
export function labelled(fields: IntakeField[], values: Record<string, string>) {
  return fields.filter((f) => values[f.key]).map((f) => ({ key: f.key, label: f.label, value: values[f.key] }));
}
