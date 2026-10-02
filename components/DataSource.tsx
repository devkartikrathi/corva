"use client";

import { useState, useTransition } from "react";
import type { Result } from "@/lib/actions/data";
import type { Rows } from "@/lib/data/postgres";
import type { Answer, Lookup, LookupInput, LookupParam } from "@/lib/data/sources";

/**
 * The business's database, as its owner sees it: the connection, the lookups
 * the assistant may run for customers, and a box to ask it anything.
 *
 * A lookup is edited as a draft and nothing reaches the assistant until it is
 * saved with "Let the assistant use this" ticked — so trying a query out is
 * free, and a half-written one is never live.
 */

type Source = { name: string; host: string; database: string; tables: { name: string; columns: string[] }[]; checked: string | null; error: string | null };
type Draft = Omit<Lookup, "id"> & { id?: string; local: string; dirty: boolean };

type Actions = {
  connect: (name: string, connection: string) => Promise<Result<{ tables: number }>>;
  refresh: () => Promise<Result<{ tables: number }>>;
  disconnect: () => Promise<Result<void>>;
  save: (input: LookupInput) => Promise<Result<Lookup>>;
  remove: (id: string) => Promise<Result<void>>;
  test: (input: LookupInput, values: Record<string, string>) => Promise<Result<Rows>>;
  suggest: () => Promise<Result<Omit<Lookup, "id">[]>>;
  ask: (question: string) => Promise<Result<Answer>>;
};

const input = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
  width: "100%",
} as const;
const mono = { ...input, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, lineHeight: 1.5 } as const;
const small = { fontSize: 11.5, fontWeight: 700, padding: "6px 10px", border: "1px solid var(--color-neutral-400)", cursor: "pointer" } as const;
const primary = { fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "8px 13px", cursor: "pointer" } as const;
const label = { fontSize: 11, fontWeight: 700, color: "var(--color-neutral-700)", display: "block", marginBottom: 4 } as const;
const box = { border: "1px solid var(--color-neutral-400)", padding: "14px 16px", background: "var(--color-bg)" } as const;
const heading = { fontSize: 15, fontWeight: 700, margin: "0 0 4px" } as const;
const lead = { fontSize: 12, color: "var(--color-neutral-700)", margin: "0 0 12px", lineHeight: 1.5, maxWidth: "72ch" } as const;

let counter = 0;
const toDraft = (l: Omit<Lookup, "id"> & { id?: string }, dirty = false): Draft => ({ ...l, local: l.id ?? `new-${counter++}`, dirty });

function Table({ result }: { result: Rows }) {
  if (result.rows.length === 0) return <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>No rows matched.</div>;
  return (
    <div style={{ overflowX: "auto", border: "1px solid var(--color-neutral-300)" }}>
      <div className="m-scroll">
      <table className="cv-table" style={{ borderCollapse: "collapse", fontSize: 11.5, width: "100%" }}>
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c} style={{ textAlign: "left", padding: "5px 8px", borderBottom: "1px solid var(--color-neutral-400)", whiteSpace: "nowrap" }}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i}>
              {result.columns.map((c) => (
                <td key={c} style={{ padding: "5px 8px", borderBottom: "1px solid var(--color-neutral-300)", verticalAlign: "top" }}>
                  {r[c] === null ? <span style={{ color: "var(--color-neutral-600)" }}>—</span> : String(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {result.truncated && <div style={{ fontSize: 11, padding: "5px 8px", color: "var(--color-neutral-700)" }}>More rows matched than are shown.</div>}
    </div>
  );
}

export function DataSource({
  ready,
  agentName,
  source,
  lookups,
  actions,
}: {
  ready: boolean;
  agentName: string;
  source: Source | null;
  lookups: Lookup[];
  actions: Actions;
}) {
  const [name, setName] = useState("");
  const [connection, setConnection] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>(() => lookups.map((l) => toDraft(l)));
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [tested, setTested] = useState<Record<string, Rows>>({});
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<{ at: string; message: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /** Run an action, show what it is doing, and put its failure next to the control that caused it. */
  function run<T>(at: string, work: () => Promise<Result<T>>, then: (value: T) => void) {
    setError(null);
    setNote(null);
    setBusy(at);
    start(async () => {
      try {
        const result = await work();
        if (result.ok) then(result.value);
        else setError({ at, message: result.error });
      } catch {
        setError({ at, message: "That did not work. Try again in a moment." });
      } finally {
        setBusy(null);
      }
    });
  }
  const problem = (at: string) =>
    error?.at === at ? (
      <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)", marginTop: 8 }}>
        {error.message}
      </div>
    ) : null;

  const change = (local: string, patch: Partial<Draft>) => setDrafts((all) => all.map((d) => (d.local === local ? { ...d, ...patch, dirty: true } : d)));
  const changeParam = (d: Draft, index: number, patch: Partial<LookupParam>) =>
    change(d.local, { params: d.params.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  const asInput = (d: Draft): LookupInput => ({ id: d.id, key: d.id ? d.key : "", name: d.name, description: d.description, sql: d.sql, params: d.params, enabled: d.enabled });

  if (!source) {
    return (
      <div style={box}>
        <h2 style={heading}>Connect a database</h2>
        <p style={lead}>
          Postgres for now (including Neon, Supabase, RDS and Railway). Give Corva a user that can only read, and
          only the tables {agentName} should answer from — Corva never writes, but a read-only user means it could
          not even if asked.
        </p>
        <pre style={{ ...mono, whiteSpace: "pre-wrap", margin: "0 0 14px", color: "var(--color-neutral-800)" }}>
          {`CREATE USER corva_reader WITH PASSWORD 'choose-a-long-one';\nGRANT USAGE ON SCHEMA public TO corva_reader;\nGRANT SELECT ON orders, bookings TO corva_reader;  -- only what it should see`}
        </pre>
        <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
          <div>
            <label style={label} htmlFor="ds-name">
              What to call it
            </label>
            <input id="ds-name" style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Orders database" />
          </div>
          <div>
            <label style={label} htmlFor="ds-conn">
              Connection string
            </label>
            <input
              id="ds-conn"
              type="password"
              autoComplete="off"
              style={mono}
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
              placeholder="postgresql://corva_reader:password@host:5432/database"
            />
            <div style={{ fontSize: 11, color: "var(--color-neutral-700)", marginTop: 4 }}>
              Stored encrypted and never shown again. The database must accept connections from the internet.
            </div>
          </div>
          <div>
            <button
              type="button"
              className="hov-accent"
              style={{ ...primary, opacity: pending || !ready ? 0.6 : 1 }}
              disabled={pending || !ready || !connection.trim()}
              onClick={() =>
                run("connect", () => actions.connect(name, connection), () => {
                  setConnection("");
                  setNote("Connected.");
                })
              }
            >
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
        {!ready && (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)", marginTop: 8 }}>
            Connecting a database is not switched on for this deployment yet (DATA_SOURCE_KEY is not set).
          </div>
        )}
        {problem("connect")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* ── The connection ── */}
      <div style={box}>
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <h2 style={{ ...heading, flex: 1, minWidth: 200 }}>{source.name}</h2>
          <button type="button" className="hov-invert" style={small} disabled={pending} onClick={() => run("source", actions.refresh, (v) => setNote(`Read ${v.tables} tables.`))}>
            {busy === "source" ? "Reading…" : "Read tables again"}
          </button>
          <button
            type="button"
            className="hov-invert"
            style={small}
            disabled={pending}
            onClick={() => {
              if (!window.confirm("Disconnect this database? Its lookups are removed and the assistant stops answering from it.")) return;
              run("source", actions.disconnect, () => setDrafts([]));
            }}
          >
            Disconnect
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
          <code>{source.host}</code> · <code>{source.database}</code> · {source.tables.length} tables
          {source.checked ? ` · read ${source.checked}` : ""}
        </div>
        {source.error && (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)", marginTop: 6 }}>
            Last check failed: {source.error}
          </div>
        )}
        {note && <div style={{ fontSize: 11.5, marginTop: 6 }}>{note}</div>}
        {problem("source")}
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Tables Corva can see</summary>
          <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 11.5 }}>
            {source.tables.map((t) => (
              <div key={t.name}>
                <code style={{ fontWeight: 700 }}>{t.name}</code> <span style={{ color: "var(--color-neutral-700)" }}>{t.columns.join(", ")}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* ── Lookups ── */}
      <div style={box}>
        <h2 style={heading}>What {agentName} may look up for customers</h2>
        <p style={lead}>
          Each lookup is one fixed query. {agentName} only fills in the values the customer gives — an order
          reference, a phone number — so a customer can be told about their own order and never anyone else&rsquo;s.
          Only the columns you select are ever read out. For anything private, ask for two values (the reference
          and the phone number it was booked with).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {drafts.length === 0 && <div style={{ fontSize: 12.5, color: "var(--color-neutral-700)" }}>No lookups yet. Let Corva suggest some from your tables, or write one.</div>}
          {drafts.map((d) => (
            <div key={d.local} style={{ border: "1px solid var(--color-neutral-300)", padding: "12px 14px", background: "var(--color-surface)" }}>
              <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(200px, 2fr)", gap: 10 }}>
                <div>
                  <label style={label}>Name</label>
                  <input style={input} value={d.name} onChange={(e) => change(d.local, { name: e.target.value })} placeholder="Order status" />
                </div>
                <div>
                  <label style={label}>When {agentName} should use it</label>
                  <input style={input} value={d.description} onChange={(e) => change(d.local, { description: e.target.value })} placeholder="When a customer asks where their order has got to" />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <label style={label}>Query — one SELECT; write :name where a value from the customer goes</label>
                <textarea style={{ ...mono, minHeight: 92, resize: "vertical" }} spellCheck={false} value={d.sql} onChange={(e) => change(d.local, { sql: e.target.value })} />
              </div>

              <div style={{ marginTop: 10 }}>
                <label style={label}>Values the customer gives</label>
                <div style={{ display: "grid", gap: 6 }}>
                  {d.params.map((p, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 130px 1fr auto", gap: 6 }}>
                      <input style={mono} value={p.name} onChange={(e) => changeParam(d, i, { name: e.target.value })} placeholder="reference" aria-label="Value name" />
                      <select style={input} value={p.kind} onChange={(e) => changeParam(d, i, { kind: e.target.value as LookupParam["kind"] })} aria-label="Kind of value">
                        <option value="text">Text</option>
                        <option value="phone">Phone number</option>
                        <option value="number">Number</option>
                      </select>
                      <input style={input} value={p.description} onChange={(e) => changeParam(d, i, { description: e.target.value })} placeholder="What it is, e.g. the order reference from their confirmation" aria-label="What the value is" />
                      <button type="button" className="hov-invert" style={small} onClick={() => change(d.local, { params: d.params.filter((_, j) => j !== i) })}>
                        Remove
                      </button>
                    </div>
                  ))}
                  {d.params.length < 4 && (
                    <div>
                      <button type="button" className="hov-invert" style={small} onClick={() => change(d.local, { params: [...d.params, { name: "", kind: "text", description: "" }] })}>
                        Add a value
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {d.params
                  .filter((p) => p.name.trim())
                  .map((p) => (
                    <input
                      key={p.name}
                      style={{ ...input, width: 160 }}
                      placeholder={`Try a ${p.name}`}
                      aria-label={`A ${p.name} to test with`}
                      value={values[d.local]?.[p.name] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [d.local]: { ...v[d.local], [p.name]: e.target.value } }))}
                    />
                  ))}
                <button
                  type="button"
                  className="hov-invert"
                  style={small}
                  disabled={pending}
                  onClick={() => run(d.local, () => actions.test(asInput(d), values[d.local] ?? {}), (rows) => setTested((t) => ({ ...t, [d.local]: rows })))}
                >
                  {busy === d.local ? "Running…" : "Test"}
                </button>
                <span style={{ flex: 1 }} />
                <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700 }}>
                  <input type="checkbox" checked={d.enabled} onChange={(e) => change(d.local, { enabled: e.target.checked })} />
                  Let {agentName} use this
                </label>
                <button
                  type="button"
                  className="hov-accent"
                  style={{ ...primary, opacity: pending || !d.dirty ? 0.6 : 1 }}
                  disabled={pending || !d.dirty}
                  onClick={() => run(d.local, () => actions.save(asInput(d)), (saved) => setDrafts((all) => all.map((x) => (x.local === d.local ? { ...toDraft(saved), local: d.local } : x))))}
                >
                  {d.id ? "Save" : "Save lookup"}
                </button>
                <button
                  type="button"
                  className="hov-invert"
                  style={small}
                  disabled={pending}
                  onClick={() => {
                    const drop = () => setDrafts((all) => all.filter((x) => x.local !== d.local));
                    if (!d.id) return drop();
                    run(d.local, () => actions.remove(d.id!), drop);
                  }}
                >
                  {d.id ? "Remove" : "Discard"}
                </button>
              </div>
              <div style={{ fontSize: 11, color: "var(--color-neutral-700)", marginTop: 6 }}>
                {!d.id ? "A draft — not saved." : d.dirty ? "Changed — not saved." : d.enabled ? `Live: ${agentName} uses this on chat and on calls.` : "Saved, but switched off."}
              </div>
              {problem(d.local)}
              {tested[d.local] && (
                <div style={{ marginTop: 10 }}>
                  <Table result={tested[d.local]} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button
            type="button"
            className="hov-accent"
            style={{ ...primary, opacity: pending ? 0.6 : 1 }}
            disabled={pending}
            onClick={() =>
              run("suggest", actions.suggest, (made) => {
                if (made.length === 0) return setNote("Nothing new to suggest from these tables. You can still write one.");
                setDrafts((all) => [...all, ...made.map((m) => toDraft(m, true))]);
              })
            }
          >
            {busy === "suggest" ? "Reading your tables…" : "Suggest lookups"}
          </button>
          <button
            type="button"
            className="hov-invert"
            style={small}
            onClick={() => setDrafts((all) => [...all, toDraft({ key: "", name: "", description: "", sql: "", params: [{ name: "reference", kind: "text", description: "" }], enabled: false }, true)])}
          >
            Write one
          </button>
        </div>
        {problem("suggest")}
      </div>

      {/* ── Ask ── */}
      <div style={box}>
        <h2 style={heading}>Ask your database</h2>
        <p style={lead}>
          For you and your team, not for customers. Ask in your own words; Corva writes the query, runs it read-only
          and shows you both the answer and the query it ran.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={input}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && question.trim() && !pending) run("ask", () => actions.ask(question), setAnswer);
            }}
            placeholder="How many orders came in this week, by service?"
            aria-label="A question for your database"
          />
          <button type="button" className="hov-accent" style={{ ...primary, opacity: pending ? 0.6 : 1, whiteSpace: "nowrap" }} disabled={pending || !question.trim()} onClick={() => run("ask", () => actions.ask(question), setAnswer)}>
            {busy === "ask" ? "Asking…" : "Ask"}
          </button>
        </div>
        {problem("ask")}
        {answer && (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{answer.answer}</div>
            {answer.result && <Table result={answer.result} />}
            {answer.sql && (
              <details>
                <summary style={{ cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>The query it ran</summary>
                <pre style={{ ...mono, whiteSpace: "pre-wrap", marginTop: 6 }}>{answer.sql}</pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
