import { isIP } from "node:net";
import { Client, types } from "pg";
import { UnreachableHostError, resolvePublic } from "@/lib/net";

/**
 * Reading a business's own Postgres database.
 *
 * Three things hold however the query got written — by the business, or by
 * the AI on a team member's behalf:
 *
 *   read only   every query runs inside a READ ONLY transaction, so the
 *               database itself refuses a write. The shape check before it is
 *               for a clear message, not for safety.
 *   bounded     a statement timeout and a row limit, so one question cannot
 *               hold a connection or pull a table.
 *   outward     the host has to be a public address. A connection string is
 *               something a stranger typed into a form; it must not be a way
 *               to reach Corva's own network.
 */

export type Snapshot = { tables: { schema: string; name: string; columns: { name: string; type: string }[] }[] };
export type Rows = { columns: string[]; rows: Record<string, string | number | boolean | null>[]; truncated: boolean };

const MAX_TABLES = 150;
const MAX_COLUMNS = 60;
const MAX_CELL = 300;

/**
 * Schemas a platform keeps for itself (sign-in, migrations, storage). Left out
 * of what the AI is shown: nothing a customer asks about lives there, and
 * some of it is credentials. Not a boundary — the read-only user is.
 */
const HOUSEKEEPING = ["drizzle", "neon_auth", "auth", "storage", "vault", "realtime", "extensions", "graphql", "graphql_public", "pgbouncer", "pgsodium", "cron", "net", "supabase_functions", "supabase_migrations", "_prisma_migrations"];

/** A message the person who connected the database can act on. */
export class DataSourceError extends Error {}

/**
 * The address a host name means, having checked it is on the public internet.
 * A host a stranger typed into a form must not be a way into Corva's own network.
 */
export async function publicAddress(hostname: string, what: string) {
  try {
    return await resolvePublic(hostname);
  } catch (e) {
    if (e instanceof UnreachableHostError && e.reason === "private") {
      throw new DataSourceError(`${what} has to be reachable from the internet. A local or private address cannot be connected.`);
    }
    throw new DataSourceError(`Could not find ${hostname}. Check the host name.`);
  }
}

type Target = { hostname: string; address: string; port: number; user: string; password: string; database: string; ssl: boolean };

/** Read a connection string, and settle which address it means before anything connects to it. */
export async function parseConnection(input: string): Promise<Target> {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new DataSourceError("That is not a connection string. It should look like postgresql://user:password@host:5432/database");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DataSourceError("Only Postgres databases can be connected for now (postgresql://…).");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!hostname || !database || !url.username) {
    throw new DataSourceError("The connection string needs a user, a host and a database name.");
  }
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new DataSourceError("That port cannot be used.");

  return {
    hostname,
    // Connect to the address that was checked, not to whatever the name says a moment later.
    address: await publicAddress(hostname, "The database"),
    port,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    ssl: url.searchParams.get("sslmode") !== "disable",
  };
}

function plain(e: unknown) {
  const err = e as { message?: string; code?: string };
  if (e instanceof DataSourceError) return e;
  const message = (err.message ?? "The database did not answer.").replace(/\s+/g, " ").slice(0, 240);
  if (err.code === "57014" || /timeout/i.test(message)) return new DataSourceError("The database took too long to answer.");
  if (err.code === "28P01" || err.code === "28000") return new DataSourceError("The database refused that user or password.");
  if (err.code === "ECONNREFUSED" || err.code === "ETIMEDOUT" || err.code === "ENOTFOUND") {
    return new DataSourceError("Could not reach the database. Check that it accepts connections from the internet.");
  }
  return new DataSourceError(message);
}

/**
 * Dates and times come back as the database wrote them. Turned into a Date
 * here they would be re-read in the server's time zone, and "delivery on the
 * 4th" would reach a customer as the 3rd.
 */
const AS_WRITTEN = new Set([1082, 1083, 1114, 1184, 1266]);
const TYPES = {
  getTypeParser: ((oid: number, format?: "text" | "binary") =>
    AS_WRITTEN.has(oid) ? (v: string) => v : types.getTypeParser(oid, format as "text")) as typeof types.getTypeParser,
};

async function withClient<T>(connection: string, timeoutMs: number, work: (c: Client) => Promise<T>): Promise<T> {
  const t = await parseConnection(connection);
  const client = new Client({
    host: t.address,
    port: t.port,
    user: t.user,
    password: t.password,
    database: t.database,
    // Encrypted in transit. The certificate is not checked against a CA list:
    // managed databases sign with their own, and refusing them would refuse most.
    ssl: t.ssl ? { servername: isIP(t.hostname) ? undefined : t.hostname, rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 6000,
    query_timeout: timeoutMs + 2000,
    application_name: "corva",
    types: TYPES,
  });
  try {
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${Math.round(timeoutMs)}`);
    return await work(client);
  } catch (e) {
    throw plain(e);
  } finally {
    await client.end().catch(() => {});
  }
}

/** The tables and columns a query may be written against. */
export async function readSnapshot(connection: string): Promise<Snapshot> {
  return withClient(connection, 8000, async (client) => {
    const { rows } = await client.query<{ s: string; t: string; c: string; d: string }>(
      `select c.table_schema as s, c.table_name as t, c.column_name as c, case when c.data_type = 'USER-DEFINED' then c.udt_name else c.data_type end as d
         from information_schema.columns c
         join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
        where x.table_type in ('BASE TABLE', 'VIEW')
          and c.table_schema not in ('pg_catalog', 'information_schema', ${HOUSEKEEPING.map((n) => `'${n}'`).join(", ")})
          and c.table_schema not like 'pg\\_%'
        order by c.table_schema, c.table_name, c.ordinal_position
        limit 9000`,
    );
    const tables = new Map<string, Snapshot["tables"][number]>();
    for (const r of rows) {
      const id = `${r.s}.${r.t}`;
      let table = tables.get(id);
      if (!table) {
        if (tables.size >= MAX_TABLES) continue;
        table = { schema: r.s, name: r.t, columns: [] };
        tables.set(id, table);
      }
      if (table.columns.length < MAX_COLUMNS) table.columns.push({ name: r.c, type: r.d });
    }
    return { tables: [...tables.values()] };
  });
}

/** The snapshot as the AI reads it: one line a table. */
export function describeSnapshot(snapshot: Snapshot) {
  return snapshot.tables
    .map((t) => `${t.schema === "public" ? "" : `${t.schema}.`}${t.name}(${t.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`)
    .join("\n");
}

const WRITES = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|merge|into|vacuum|listen|notify)\b/i;

/** One SELECT and nothing else. Returns it without its trailing semicolon. */
export function checkSelect(input: string) {
  const sql = input.trim().replace(/;\s*$/, "");
  if (!sql) throw new DataSourceError("Write the query first.");
  if (sql.length > 4000) throw new DataSourceError("That query is too long.");
  if (sql.includes(";")) throw new DataSourceError("One query at a time: remove the semicolon.");
  if (sql.includes("--") || sql.includes("/*")) throw new DataSourceError("Remove the comments from the query.");
  if (!/^(select|with)\b/i.test(sql)) throw new DataSourceError("The query has to start with SELECT.");
  const word = sql.match(WRITES)?.[0];
  if (word) throw new DataSourceError(`A lookup can only read. "${word.toUpperCase()}" is not allowed.`);
  return sql;
}

/** `:name` for each named parameter becomes `$1`, `$2`… in the order given. */
export function bindNames(sql: string, names: string[]) {
  let text = sql;
  names.forEach((name, i) => {
    text = text.replace(new RegExp(`(?<!:):${name}\\b`, "g"), `$${i + 1}`);
  });
  return text;
}

function cell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return "[binary]";
  const text = typeof v === "object" ? JSON.stringify(v) : String(v);
  // numeric arrives as text, at full scale: 450.0000000000000000 is 450.
  if (/^-?\d+\.\d+$/.test(text)) return text.replace(/0+$/, "").replace(/\.$/, "");
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text;
}

/** Run one SELECT, read only, and return at most `limit` rows. */
export async function runSelect(
  connection: string,
  input: string,
  opts: { names?: string[]; values?: (string | null)[]; limit: number; timeoutMs: number },
): Promise<Rows> {
  const sql = bindNames(checkSelect(input), opts.names ?? []);
  return withClient(connection, opts.timeoutMs, async (client) => {
    // One more than asked for, to know whether there was more.
    const result = await client.query(`select * from (${sql}) as corva_q limit ${opts.limit + 1}`, opts.values ?? []);
    const columns = result.fields.map((f) => f.name);
    const rows = result.rows.slice(0, opts.limit).map((r: Record<string, unknown>) => Object.fromEntries(columns.map((c) => [c, cell(r[c])])));
    return { columns, rows, truncated: result.rows.length > opts.limit };
  });
}

/** Have the database check a query against its own tables, without running it. */
export async function checkAgainstDatabase(connection: string, input: string, names: string[]) {
  const sql = bindNames(checkSelect(input), names);
  await withClient(connection, 5000, async (client) => {
    await client.query(`PREPARE corva_check AS ${sql}`);
  });
}
