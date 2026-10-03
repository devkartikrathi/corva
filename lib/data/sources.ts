import { generateObject, generateText } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { languageModel, thinkingOptions } from "@/lib/agent/model";
import { resolveModel } from "@/lib/agent/models";
import { seal, unseal } from "./crypto";
import { DataSourceError, checkAgainstDatabase, checkSelect, describeSnapshot, parseConnection, readSnapshot, runSelect, type Rows } from "./postgres";

/**
 * A business's own database, connected to its assistant.
 *
 * Two ways in, for two kinds of asker:
 *
 *   lookups   fixed queries the business has approved ("order status by
 *             reference"). The assistant may run these for a customer on chat
 *             or a call, supplying only the parameters.
 *   asking    anything, in words, for the business's own team in the console.
 *             The AI writes the query; it runs read only.
 *
 * A customer never reaches the second. That is the whole design: the people
 * who can ask for anything are the people whose data it is.
 */

export type LookupParam = { name: string; description: string; kind: "text" | "phone" | "number" };
export type Lookup = { id: string; key: string; name: string; description: string; sql: string; params: LookupParam[]; enabled: boolean };
export type LookupInput = Omit<Lookup, "id"> & { id?: string };

const MAX_LOOKUPS = 12;
const LOOKUP_ROWS = 5;
const LOOKUP_TIMEOUT_MS = 4000;
const ASK_ROWS = 100;
const ASK_TIMEOUT_MS = 8000;
const PARAM_KINDS = ["text", "phone", "number"] as const;

const slug = (v: string, max: number) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);

const lookupOf = (r: typeof s.dataLookups.$inferSelect): Lookup => ({
  id: r.id,
  key: r.key,
  name: r.name,
  description: r.description,
  sql: r.sql,
  params: r.params,
  enabled: r.enabled,
});

/* ─── The connection ───────────────────────────────────────────────────── */

export async function sourceFor(brandId: string) {
  const [row] = await db.select().from(s.dataSources).where(eq(s.dataSources.brandId, brandId)).limit(1);
  return row ?? null;
}

/** Connect a database: prove it answers, read its tables, and keep the connection sealed. */
export async function connectSource(brandId: string, input: { name: string; connection: string }, by: string) {
  const connection = input.connection.trim();
  const target = await parseConnection(connection);
  const snapshot = await readSnapshot(connection);
  if (snapshot.tables.length === 0) {
    throw new DataSourceError("Connected, but this user cannot see any tables. Grant it SELECT on the tables the assistant should read.");
  }
  const values = {
    name: input.name.trim().slice(0, 60) || target.database,
    connection: seal(connection),
    host: target.hostname,
    databaseName: target.database,
    snapshot,
    lastCheckedAt: new Date(),
    lastError: null,
  };
  const [row] = await db
    .insert(s.dataSources)
    .values({ brandId, kind: "postgres", createdByName: by, ...values })
    .onConflictDoUpdate({ target: s.dataSources.brandId, set: values })
    .returning();
  return row;
}

/** Read the tables again, after the business has changed its schema. */
export async function refreshSource(brandId: string) {
  const source = await sourceFor(brandId);
  if (!source) throw new DataSourceError("No database is connected.");
  try {
    const snapshot = await readSnapshot(unseal(source.connection));
    await db.update(s.dataSources).set({ snapshot, lastCheckedAt: new Date(), lastError: null }).where(eq(s.dataSources.id, source.id));
    return snapshot;
  } catch (e) {
    await db.update(s.dataSources).set({ lastCheckedAt: new Date(), lastError: (e as Error).message.slice(0, 240) }).where(eq(s.dataSources.id, source.id));
    throw e;
  }
}

/** Forget the database, and the lookups that were written against it. */
export async function disconnectSource(brandId: string) {
  const [row] = await db.delete(s.dataSources).where(eq(s.dataSources.brandId, brandId)).returning();
  return row ?? null;
}

/* ─── Lookups ──────────────────────────────────────────────────────────── */

export async function lookupsFor(brandId: string, onlyEnabled = false): Promise<Lookup[]> {
  const rows = await db
    .select()
    .from(s.dataLookups)
    .where(onlyEnabled ? and(eq(s.dataLookups.brandId, brandId), eq(s.dataLookups.enabled, true)) : eq(s.dataLookups.brandId, brandId))
    .orderBy(asc(s.dataLookups.createdAt));
  return rows.map(lookupOf);
}

/** A lookup as it will be stored — or the reason it cannot be. */
function cleanLookup(input: LookupInput): Omit<Lookup, "id"> {
  const name = String(input.name ?? "").trim().slice(0, 60);
  if (!name) throw new DataSourceError("Give the lookup a name.");
  const key = slug(input.key || name, 40);
  if (!key) throw new DataSourceError("Give the lookup a name with letters in it.");
  const sql = checkSelect(String(input.sql ?? ""));

  const seen = new Set<string>();
  const params = (Array.isArray(input.params) ? input.params : []).slice(0, 4).map((p) => {
    const pname = slug(String(p?.name ?? ""), 30);
    if (!pname || /^\d/.test(pname)) throw new DataSourceError("Each value the customer gives needs a name, like reference or phone.");
    if (pname === "lookup") throw new DataSourceError('A value cannot be called "lookup".');
    if (seen.has(pname)) throw new DataSourceError(`"${pname}" is listed twice.`);
    seen.add(pname);
    if (!new RegExp(`(?<!:):${pname}\\b`).test(sql)) throw new DataSourceError(`The query never uses :${pname}. Use it in the WHERE, or remove it.`);
    return {
      name: pname,
      description: String(p?.description ?? "").trim().slice(0, 160),
      kind: PARAM_KINDS.includes(p?.kind) ? p.kind : "text",
    } satisfies LookupParam;
  });
  // Without a value to filter by, the query is the same for every asker — a
  // way for a stranger to read the table rather than their own row.
  if (params.length === 0) {
    throw new DataSourceError("A lookup needs at least one value from the customer (an order reference, a phone number) to filter by.");
  }
  return { key, name, description: String(input.description ?? "").trim().slice(0, 300), sql, params, enabled: Boolean(input.enabled) };
}

/** Save a lookup, having had the database check the query against its tables. */
export async function saveLookup(brandId: string, input: LookupInput): Promise<Lookup> {
  const source = await sourceFor(brandId);
  if (!source) throw new DataSourceError("Connect a database first.");
  const clean = cleanLookup(input);
  await checkAgainstDatabase(unseal(source.connection), clean.sql, clean.params.map((p) => p.name));

  const existing = await db.select({ id: s.dataLookups.id, key: s.dataLookups.key }).from(s.dataLookups).where(eq(s.dataLookups.brandId, brandId));
  if (existing.some((l) => l.key === clean.key && l.id !== input.id)) throw new DataSourceError(`There is already a lookup called ${clean.key}.`);

  if (input.id) {
    const [row] = await db
      .update(s.dataLookups)
      .set({ ...clean, lastError: null, updatedAt: new Date() })
      .where(and(eq(s.dataLookups.id, input.id), eq(s.dataLookups.brandId, brandId)))
      .returning();
    if (!row) throw new DataSourceError("No such lookup for this business.");
    return lookupOf(row);
  }
  if (existing.length >= MAX_LOOKUPS) throw new DataSourceError(`${MAX_LOOKUPS} lookups at most. Remove one first.`);
  const [row] = await db.insert(s.dataLookups).values({ brandId, sourceId: source.id, ...clean }).returning();
  return lookupOf(row);
}

export async function deleteLookup(brandId: string, id: string) {
  const [row] = await db.delete(s.dataLookups).where(and(eq(s.dataLookups.id, id), eq(s.dataLookups.brandId, brandId))).returning();
  if (!row) throw new DataSourceError("No such lookup for this business.");
  return lookupOf(row);
}

/** What the customer said, as the value the query is given — or why it will not do. */
function valueFor(param: LookupParam, raw: unknown): string {
  const text = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!text) throw new DataSourceError(`Ask the customer for ${param.description || param.name} first.`);
  if (text.length > 120) throw new DataSourceError(`That ${param.name} is too long.`);
  if (param.kind === "phone") {
    const digits = text.replace(/\D/g, "");
    if (digits.length < 10) throw new DataSourceError("A full ten-digit phone number is needed.");
    // Stored formats differ (+91…, spaces, a leading 0); the last ten digits do not.
    return digits.slice(-10);
  }
  if (param.kind === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(text)) throw new DataSourceError(`${param.name} should be a number.`);
    return text;
  }
  return text;
}

/** Run a draft against the database, for the Test button. Nothing is saved. */
export async function tryLookup(brandId: string, input: LookupInput, values: Record<string, unknown>): Promise<Rows> {
  const source = await sourceFor(brandId);
  if (!source) throw new DataSourceError("Connect a database first.");
  const clean = cleanLookup(input);
  return runSelect(unseal(source.connection), clean.sql, {
    names: clean.params.map((p) => p.name),
    values: clean.params.map((p) => valueFor(p, values[p.name])),
    limit: LOOKUP_ROWS,
    timeoutMs: LOOKUP_TIMEOUT_MS,
  });
}

/* ─── The assistant's side ─────────────────────────────────────────────── */

export const DATA_TOOL = "look_up_data";

/**
 * Best-effort, per instance: how many lookups one conversation has run. A
 * customer checking their order needs one or two; a conversation on its
 * fifteenth is trying references until one answers.
 */
const MAX_PER_CONVERSATION = 15;
const used = new Map<string, number>();

export type LookupResult =
  | { found: true; rows: Rows["rows"]; more: boolean }
  | { found: false; reason: string };

/** Run an approved lookup for a customer. Never throws: the assistant gets a sentence it can act on. */
export async function runLookupForAssistant(brandId: string, conversationId: string, key: string, values: Record<string, unknown>): Promise<LookupResult> {
  const count = (used.get(conversationId) ?? 0) + 1;
  if (used.size > 5000) used.clear();
  used.set(conversationId, count);
  if (count > MAX_PER_CONVERSATION) {
    return { found: false, reason: "Too many lookups in this conversation. Offer to have the team check and call back." };
  }

  const [row] = await db
    .select({ lookup: s.dataLookups, source: s.dataSources })
    .from(s.dataLookups)
    .innerJoin(s.dataSources, eq(s.dataSources.id, s.dataLookups.sourceId))
    .where(and(eq(s.dataLookups.brandId, brandId), eq(s.dataLookups.key, key), eq(s.dataLookups.enabled, true)))
    .limit(1);
  if (!row) return { found: false, reason: "There is no such lookup. Offer to have the team check and call back." };

  let bound: string[];
  try {
    bound = row.lookup.params.map((p) => valueFor(p, values[p.name]));
  } catch (e) {
    return { found: false, reason: (e as Error).message };
  }

  /**
   * A phone number only finds the person's own records.
   *
   * Anyone can type a number into a website chat, so a lookup by phone runs
   * only for a number Corva knows the customer is contacting from — on
   * WhatsApp, where WhatsApp itself says who is writing (and, later, on a
   * phone line with caller id). Anywhere else the customer is asked for their
   * reference instead, which is something only they were given.
   */
  const phoneAt = row.lookup.params.findIndex((p) => p.kind === "phone");
  if (phoneAt >= 0) {
    const [conv] = await db
      .select({ channel: s.conversations.channel, phone: s.customers.phone })
      .from(s.conversations)
      .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
      .where(eq(s.conversations.id, conversationId))
      .limit(1);
    const verified = conv?.channel === "whatsapp" ? conv.phone : null;
    const last10 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-10);
    if (!verified) {
      return { found: false, reason: "For the customer's privacy, records are looked up by phone number only on WhatsApp from that number. Ask for their order reference instead." };
    }
    if (last10(bound[phoneAt]) !== last10(verified)) {
      return { found: false, reason: "That is not the number this customer is writing from, so it cannot be looked up. Offer to look up their own number, or ask for the order reference." };
    }
  }

  try {
    const result = await runSelect(unseal(row.source.connection), row.lookup.sql, {
      names: row.lookup.params.map((p) => p.name),
      values: bound,
      limit: LOOKUP_ROWS,
      timeoutMs: LOOKUP_TIMEOUT_MS,
    });
    void db.update(s.dataLookups).set({ lastRunAt: new Date(), lastError: null }).where(eq(s.dataLookups.id, row.lookup.id)).catch(() => {});
    if (result.rows.length === 0) {
      return { found: false, reason: "Nothing matches that. Read back what you were given to check it, and if it is right, offer to have the team look into it." };
    }
    return { found: true, rows: result.rows, more: result.truncated };
  } catch (e) {
    const message = (e as Error).message.slice(0, 240);
    console.error(`[data] lookup ${key} failed:`, message);
    void db.update(s.dataLookups).set({ lastRunAt: new Date(), lastError: message }).where(eq(s.dataLookups.id, row.lookup.id)).catch(() => {});
    // The reason is the business's to read in Settings, not the customer's to hear.
    return { found: false, reason: "The records could not be reached just now. Say so, and offer to have the team check and call back." };
  }
}

/** Every value any lookup takes, once each — the tool's arguments beside `lookup`. */
export function lookupArguments(lookups: Lookup[]) {
  const all = new Map<string, string>();
  for (const l of lookups) {
    for (const p of l.params) {
      const line = p.description || p.name;
      all.set(p.name, all.has(p.name) && !all.get(p.name)!.includes(line) ? `${all.get(p.name)}; ${line}` : (all.get(p.name) ?? line));
    }
  }
  return [...all].map(([name, description]) => ({ name, description }));
}

export const DATA_TOOL_DESCRIPTION =
  "Look something up in the business's own records, live. Choose the lookup and give the values it needs. " +
  "Returns the matching rows, or says nothing matched.";

/** What the assistant is told about the lookups it has. Empty when it has none. */
export function lookupInstructions(lookups: Lookup[]) {
  if (lookups.length === 0) return "";
  return [
    `You can check the business's own records with ${DATA_TOOL}. The lookups you have:`,
    ...lookups.map((l) => `- ${l.key}: ${(l.description || l.name).replace(/\.+$/, "")}. Needs ${l.params.map((p) => `${p.name}${p.description ? ` (${p.description})` : ""}`).join(" and ")}.`),
    "Ask the customer for the values a lookup needs before you call it. Tell them only what answers",
    "their question, in plain words; never read out a whole row, an internal id or a column name.",
    "If nothing matches, say so and check the value with them. Never guess at what the records say.",
  ].join("\n");
}

/* ─── Writing queries with the AI ──────────────────────────────────────── */

const SQL_RULES = `Postgres only. One SELECT statement, no semicolon, no comments. Use only the tables and
columns listed. Quote identifiers that need it ("Order", "createdAt").`;

const Suggestions = z.object({
  lookups: z
    .array(
      z.object({
        name: z.string().describe("Two to four words, e.g. Order status"),
        description: z.string().describe("When the assistant should use it, in one sentence"),
        sql: z.string(),
        params: z.array(z.object({ name: z.string(), description: z.string(), kind: z.enum(PARAM_KINDS) })).min(1).max(3),
      }),
    )
    .max(5),
});

/**
 * Draft lookups from the tables: what a customer of this business would ask
 * about their own order, booking or account. Drafts only — each is checked
 * against the database, and none is switched on.
 */
export async function suggestLookups(brand: { id: string; name: string; industry: string; modelId: string }): Promise<Omit<Lookup, "id">[]> {
  const source = await sourceFor(brand.id);
  if (!source) throw new DataSourceError("Connect a database first.");
  const model = resolveModel(brand.modelId);
  const { object } = await generateObject({
    model: languageModel(model.id),
    providerOptions: thinkingOptions(model.thinking.analysis),
    schema: Suggestions,
    system: `You set up the AI front desk for ${brand.name} (${brand.industry}). It answers customers on website
chat and on the phone. Below are the tables in the business's own database. Write up to five lookups the
assistant could run to answer what a customer asks about their OWN order, booking, appointment,
delivery or account.

Each lookup is a fixed query. The assistant only supplies the parameter values, which the customer
gives it. So:
- Every lookup filters by at least one value the customer knows: a reference or order number, or
  their phone number. Write each as :name in the query.
- A phone parameter (kind "phone") arrives as the last ten digits. Compare it as
  right(regexp_replace(the_column, '\\D', '', 'g'), 10) = :phone
- Compare references without regard to case: upper(col) = upper(:reference).
- Select only the few columns that answer the question (status, dates, amount, items). Never select
  passwords, tokens, internal notes, or another person's details.
- Name the columns so a row reads plainly, and convert stored units: amount_paise / 100.0 AS
  amount_rupees.
- Most recent first, LIMIT 5.
- ${SQL_RULES}
If the tables hold nothing a customer would ask about, return no lookups.`,
    prompt: describeSnapshot(source.snapshot),
  });

  const connection = unseal(source.connection);
  const taken = new Set((await lookupsFor(brand.id)).map((l) => l.key));
  const drafts: Omit<Lookup, "id">[] = [];
  for (const raw of object.lookups) {
    try {
      const clean = cleanLookup({ ...raw, key: "", enabled: false });
      if (taken.has(clean.key)) continue;
      await checkAgainstDatabase(connection, clean.sql, clean.params.map((p) => p.name));
      taken.add(clean.key);
      drafts.push(clean);
    } catch {
      // A draft the database will not accept is not worth showing.
    }
  }
  return drafts;
}

const Query = z.object({
  sql: z.string().describe("The query, or an empty string if the tables cannot answer the question"),
  reason: z.string().describe("If sql is empty: what is missing, in one sentence"),
});

export type Answer = { answer: string; sql: string; result: Rows | null };

/** A question from the business's own team, answered from its database. */
export async function askData(brand: { id: string; name: string; modelId: string }, question: string): Promise<Answer> {
  const source = await sourceFor(brand.id);
  if (!source) throw new DataSourceError("Connect a database first.");
  const asked = question.trim().slice(0, 500);
  if (!asked) throw new DataSourceError("Ask a question first.");
  const connection = unseal(source.connection);
  const model = resolveModel(brand.modelId);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

  let failure = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const { object } = await generateObject({
      model: languageModel(model.id),
      providerOptions: thinkingOptions(model.thinking.analysis),
      schema: Query,
      system: `You write one Postgres query to answer a question from the team at ${brand.name}, from the
business's own database. ${SQL_RULES} Today is ${today} (Asia/Kolkata). Prefer a small, readable result:
aggregate when the question is "how many" or "how much", and limit lists to 50 rows.

Tables:
${describeSnapshot(source.snapshot)}`,
      prompt: failure ? `${asked}\n\nYour last query failed with: ${failure}\nWrite a corrected one.` : asked,
    });
    if (!object.sql.trim()) return { answer: object.reason || "The connected tables do not hold that.", sql: "", result: null };
    try {
      const result = await runSelect(connection, object.sql, { limit: ASK_ROWS, timeoutMs: ASK_TIMEOUT_MS });
      const { text } = await generateText({
        model: languageModel(model.id),
        providerOptions: thinkingOptions("minimal"),
        system: `Answer the question in one to three plain sentences, from the query result only. Give the
numbers. Amounts are in the units the data uses; do not invent a currency. If the result is empty, say so.`,
        prompt: `Question: ${asked}\n\nResult (${result.rows.length} rows${result.truncated ? ", more not shown" : ""}):\n${JSON.stringify(result.rows.slice(0, 30))}`,
      });
      return { answer: text.trim(), sql: checkSelect(object.sql), result };
    } catch (e) {
      failure = (e as Error).message;
    }
  }
  throw new DataSourceError(`The query could not be run: ${failure}`);
}
