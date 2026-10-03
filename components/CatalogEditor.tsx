"use client";

import { unstable_rethrow } from "next/navigation";
import { useMemo, useState, useTransition, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { deleteGroup, deleteItem, move, saveGroup, saveItem, setItemAvailable } from "@/lib/actions/catalog";
import type { CatalogGroup, CatalogItem } from "@/lib/catalog";

/**
 * Products & services, edited in place.
 *
 * Groups nest as deep as the business wants and items sit in any of them. Each
 * save goes straight to the server — and from there into what the AI quotes —
 * so there is no page-wide Save: an item is either saved or still open in its
 * form, never half-published.
 */

type Editing =
  | { kind: "group"; id?: string; parentId: string | null }
  | { kind: "item"; id?: string; categoryId: string | null }
  | null;

const input: CSSProperties = {
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-surface)",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  color: "var(--color-text)",
  borderRadius: 0,
  width: "100%",
};

const small: CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  padding: "5px 9px",
  border: "1px solid var(--color-neutral-400)",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

/** The small outline button, dimmed when it cannot be pressed. */
function Btn({ danger, style, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      style={{
        ...small,
        ...(danger ? { color: "var(--color-accent-700)" } : {}),
        ...(props.disabled ? { opacity: 0.35, cursor: "default" } : {}),
        ...style,
      }}
    />
  );
}

const primary: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  padding: "8px 14px",
  background: "var(--color-accent)",
  color: "var(--color-bg)",
  cursor: "pointer",
};

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 10.5, color: "var(--color-neutral-700)" };

const errorText = (e: unknown) => {
  const message = e instanceof Error ? e.message : "Something went wrong.";
  return message.startsWith("Minified React error")
    ? "The server refused that. Refresh to see where things stand."
    : message.replace(/^Error:\s*/, "");
};

function priceLabel(item: CatalogItem) {
  if (item.pricePaise === null) return "On request";
  const amount =
    item.pricePaise === 0
      ? "Free"
      : `₹${(item.pricePaise / 100).toLocaleString("en-IN", { maximumFractionDigits: item.pricePaise % 100 ? 2 : 0, minimumFractionDigits: item.pricePaise % 100 ? 2 : 0 })}`;
  return item.priceUnit ? `${amount} ${item.priceUnit}` : amount;
}

const matches = (q: string, ...texts: (string | null)[]) => texts.some((t) => t?.toLowerCase().includes(q));

/** A group as the filter sees it: itself if it matches, else only what inside it does. */
function filterGroup(g: CatalogGroup, q: string): CatalogGroup | null {
  if (!q || matches(q, g.name, g.description)) return g;
  const items = g.items.filter((i) => matches(q, i.name, i.description, i.priceUnit));
  const children = g.children.map((c) => filterGroup(c, q)).filter((c): c is CatalogGroup => c !== null);
  return items.length || children.length ? { ...g, items, children } : null;
}

export function CatalogEditor({
  groups,
  loose,
  editable,
  agentName,
}: {
  groups: CatalogGroup[];
  loose: CatalogItem[];
  editable: boolean;
  agentName: string;
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [query, setQuery] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shownGroups = useMemo(() => groups.map((g) => filterGroup(g, q)).filter((g): g is CatalogGroup => g !== null), [groups, q]);
  const shownLoose = q ? loose.filter((i) => matches(q, i.name, i.description, i.priceUnit)) : loose;

  // Every group, indented, for the "In group" pickers.
  const allGroups = useMemo(() => {
    const out: { id: string; label: string; depth: number }[] = [];
    const walk = (list: CatalogGroup[], depth: number) => {
      for (const g of list) {
        out.push({ id: g.id, label: g.path.join(" › "), depth });
        walk(g.children, depth + 1);
      }
    };
    walk(groups, 0);
    return out;
  }, [groups]);

  /** Run a server write; a refusal shows beside the controls rather than vanishing. */
  const run = (work: () => Promise<unknown>, after?: () => void) =>
    start(async () => {
      setError(null);
      try {
        await work();
        after?.();
      } catch (e) {
        unstable_rethrow(e);
        setError(errorText(e));
      }
    });

  const empty = groups.length === 0 && loose.length === 0;
  const tools = { editable, editing, setEditing, run, pending, allGroups, agentName };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!empty && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or description"
            aria-label="Filter products and services"
            style={{ ...input, width: 260 }}
          />
        )}
        <span style={{ flex: 1 }} />
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "var(--color-accent-700)" }}>
            {error}
          </span>
        )}
        {pending && <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>Saving…</span>}
        {editable && (
          <>
            <Btn onClick={() => setEditing({ kind: "item", categoryId: null })}>
              + Item
            </Btn>
            <button type="button" style={primary} onClick={() => setEditing({ kind: "group", parentId: null })}>
              + Group
            </button>
          </>
        )}
      </div>

      {editing?.kind === "group" && !editing.id && editing.parentId === null && (
        <div style={{ marginTop: 14 }}>
          <GroupForm tools={tools} parentId={null} />
        </div>
      )}
      {editing?.kind === "item" && !editing.id && editing.categoryId === null && (
        <div style={{ marginTop: 14 }}>
          <ItemForm tools={tools} categoryId={null} />
        </div>
      )}

      {empty && editing === null && (
        <div style={{ marginTop: 18, border: "1px dashed var(--color-neutral-400)", padding: "22px 20px", maxWidth: 720 }}>
          <b style={{ fontSize: 14 }}>Nothing listed yet.</b>
          <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55, color: "var(--color-neutral-800)" }}>
            Add what you sell, so {agentName} can tell customers what you offer and what it costs. Start with a group —
            a service line like <i>Dry cleaning</i>, a department, a menu section — and add items inside it with a price
            and a description. Groups can hold groups too: <i>Dry cleaning › Men&apos;s wear › Shirt</i>.
          </p>
        </div>
      )}

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {shownGroups.map((g, i) => (
          <Group key={g.id} group={g} depth={0} first={i === 0} last={i === shownGroups.length - 1} tools={tools} />
        ))}
        {shownLoose.length > 0 && (
          <section style={{ border: "1px solid var(--color-neutral-400)", background: "var(--color-bg)" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-neutral-300)", fontSize: 13, fontWeight: 800 }}>
              Not in a group
            </div>
            <Items items={shownLoose} tools={tools} />
          </section>
        )}
        {q && shownGroups.length === 0 && shownLoose.length === 0 && (
          <p style={{ fontSize: 12.5, color: "var(--color-neutral-700)" }}>Nothing matches “{query}”.</p>
        )}
      </div>
    </div>
  );
}

type Tools = {
  editable: boolean;
  editing: Editing;
  setEditing: (e: Editing) => void;
  run: (work: () => Promise<unknown>, after?: () => void) => void;
  pending: boolean;
  allGroups: { id: string; label: string; depth: number }[];
  agentName: string;
};

function Group({ group: g, depth, first, last, tools }: { group: CatalogGroup; depth: number; first: boolean; last: boolean; tools: Tools }) {
  const { editable, editing, setEditing, run, pending } = tools;
  const isEditing = editing?.kind === "group" && editing.id === g.id;
  const addingGroup = editing?.kind === "group" && !editing.id && editing.parentId === g.id;
  const addingItem = editing?.kind === "item" && !editing.id && editing.categoryId === g.id;
  const total = countAll(g);

  return (
    <section
      style={{
        border: depth === 0 ? "1px solid var(--color-neutral-400)" : undefined,
        borderLeft: depth > 0 ? "3px solid var(--color-neutral-300)" : undefined,
        background: "var(--color-bg)",
        marginLeft: depth > 0 ? 14 : 0,
      }}
    >
      {isEditing ? (
        <div style={{ padding: 12 }}>
          <GroupForm tools={tools} group={g} parentId={g.parentId} />
        </div>
      ) : (
        <div
          style={{
            padding: depth === 0 ? "12px 14px" : "9px 12px",
            borderBottom: g.items.length || g.children.length || addingItem || addingGroup ? "1px solid var(--color-neutral-300)" : undefined,
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <b style={{ fontSize: depth === 0 ? 15 : 13 }}>{g.name}</b>
              <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
                {total} item{total === 1 ? "" : "s"}
              </span>
            </div>
            {g.description && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--color-neutral-800)", lineHeight: 1.45, whiteSpace: "pre-wrap" }}>
                {g.description}
              </p>
            )}
          </div>
          {editable && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Btn onClick={() => setEditing({ kind: "item", categoryId: g.id })}>
                + Item
              </Btn>
              <Btn onClick={() => setEditing({ kind: "group", parentId: g.id })}>
                + Group inside
              </Btn>
              <Btn onClick={() => setEditing({ kind: "group", id: g.id, parentId: g.parentId })}>
                Edit
              </Btn>
              <Btn aria-label={`Move ${g.name} up`} disabled={first || pending} onClick={() => run(() => move("group", g.id, -1))}>
                ↑
              </Btn>
              <Btn aria-label={`Move ${g.name} down`} disabled={last || pending} onClick={() => run(() => move("group", g.id, 1))}>
                ↓
              </Btn>
              <Btn danger
                disabled={pending}
                onClick={() => {
                  const inside = total + countGroups(g);
                  if (inside > 0 && !window.confirm(`Delete “${g.name}” and everything in it (${total} item${total === 1 ? "" : "s"})?`)) return;
                  run(() => deleteGroup(g.id));
                }}
              >
                Delete
              </Btn>
            </div>
          )}
        </div>
      )}

      {addingItem && (
        <div style={{ padding: 12, borderBottom: "1px solid var(--color-neutral-300)" }}>
          <ItemForm tools={tools} categoryId={g.id} />
        </div>
      )}
      {g.items.length > 0 && <Items items={g.items} tools={tools} />}

      {(g.children.length > 0 || addingGroup) && (
        <div style={{ padding: "10px 12px 12px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {addingGroup && (
            <div style={{ marginLeft: 14 }}>
              <GroupForm tools={tools} parentId={g.id} />
            </div>
          )}
          {g.children.map((c, i) => (
            <Group key={c.id} group={c} depth={depth + 1} first={i === 0} last={i === g.children.length - 1} tools={tools} />
          ))}
        </div>
      )}
    </section>
  );
}

function countAll(g: CatalogGroup): number {
  return g.items.length + g.children.reduce((n, c) => n + countAll(c), 0);
}
function countGroups(g: CatalogGroup): number {
  return g.children.length + g.children.reduce((n, c) => n + countGroups(c), 0);
}

function Items({ items, tools }: { items: CatalogItem[]; tools: Tools }) {
  const { editable, editing, setEditing, run, pending } = tools;
  return (
    <div>
      {items.map((item, i) => {
        if (editing?.kind === "item" && editing.id === item.id) {
          return (
            <div key={item.id} style={{ padding: 12, borderBottom: "1px solid var(--color-neutral-300)" }}>
              <ItemForm tools={tools} item={item} categoryId={item.categoryId} />
            </div>
          );
        }
        return (
          <div
            key={item.id}
            className="hov-surface"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 150px auto",
              gap: 12,
              padding: "9px 14px",
              borderBottom: i === items.length - 1 ? undefined : "1px solid var(--color-neutral-300)",
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0, opacity: item.available ? 1 : 0.6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <b style={{ fontSize: 13 }}>{item.name}</b>
                <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
                  {item.kind}
                </span>
                {!item.available && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-accent-700)" }}>
                    Not available
                  </span>
                )}
              </div>
              {item.description && (
                <p
                  style={{
                    margin: "3px 0 0",
                    fontSize: 11.5,
                    color: "var(--color-neutral-800)",
                    lineHeight: 1.45,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {item.description}
                </p>
              )}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, textAlign: "right", paddingTop: 1, opacity: item.available ? 1 : 0.6 }}>
              {priceLabel(item)}
            </div>
            {editable ? (
              <div style={{ display: "flex", gap: 4 }}>
                <Btn onClick={() => setEditing({ kind: "item", id: item.id, categoryId: item.categoryId })}>
                  Edit
                </Btn>
                <Btn
                  disabled={pending}
                  title={item.available ? "Mark as not available right now" : "Mark as available again"}
                  onClick={() => run(() => setItemAvailable(item.id, !item.available))}
                >
                  {item.available ? "Pause" : "Resume"}
                </Btn>
                <Btn aria-label={`Move ${item.name} up`} disabled={i === 0 || pending} onClick={() => run(() => move("item", item.id, -1))}>
                  ↑
                </Btn>
                <Btn aria-label={`Move ${item.name} down`} disabled={i === items.length - 1 || pending} onClick={() => run(() => move("item", item.id, 1))}>
                  ↓
                </Btn>
                <Btn danger
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Delete “${item.name}”?`)) run(() => deleteItem(item.id));
                  }}
                >
                  Delete
                </Btn>
              </div>
            ) : (
              <span />
            )}
          </div>
        );
      })}
    </div>
  );
}

function FormShell({ children, onSubmit, title }: { children: ReactNode; onSubmit: () => void; title: string }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ border: "2px solid var(--color-text)", background: "var(--color-surface)", padding: "12px 14px" }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
        {title}
      </div>
      {children}
    </form>
  );
}

function FormButtons({ tools, label: text }: { tools: Tools; label: string }) {
  return (
    <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Btn onClick={() => tools.setEditing(null)}>
        Cancel
      </Btn>
      <button type="submit" disabled={tools.pending} style={primary}>
        {tools.pending ? "Saving…" : text}
      </button>
    </div>
  );
}

function GroupForm({ tools, group, parentId }: { tools: Tools; group?: CatalogGroup; parentId: string | null }) {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [parent, setParent] = useState(parentId ?? "");

  // A group cannot move inside itself or below it.
  const blocked = new Set<string>();
  if (group) {
    const walk = (g: CatalogGroup) => {
      blocked.add(g.id);
      g.children.forEach(walk);
    };
    walk(group);
  }

  return (
    <FormShell
      title={group ? `Edit ${group.name}` : "New group"}
      onSubmit={() =>
        tools.run(
          () => saveGroup({ id: group?.id, parentId: parent || null, name, description }),
          () => tools.setEditing(null),
        )
      }
    >
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label style={label}>
          Name
          <input autoFocus required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dry cleaning" style={input} />
        </label>
        <label style={label}>
          Inside
          <select value={parent} onChange={(e) => setParent(e.target.value)} style={input}>
            <option value="">Top level</option>
            {tools.allGroups
              .filter((g) => !blocked.has(g.id))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
          </select>
        </label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>
          About this group (optional) — anything true of everything in it
          <textarea
            value={description}
            maxLength={2000}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Ready in 48 hours. Free pickup and delivery above ₹500."
            style={{ ...input, resize: "vertical" }}
          />
        </label>
      </div>
      <FormButtons tools={tools} label={group ? "Save group" : "Add group"} />
    </FormShell>
  );
}

function ItemForm({ tools, item, categoryId }: { tools: Tools; item?: CatalogItem; categoryId: string | null }) {
  const [name, setName] = useState(item?.name ?? "");
  const [kind, setKind] = useState<"service" | "product">(item?.kind === "product" ? "product" : "service");
  const [price, setPrice] = useState(item?.pricePaise != null ? String(item.pricePaise / 100) : "");
  const [priceUnit, setPriceUnit] = useState(item?.priceUnit ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [available, setAvailable] = useState(item?.available ?? true);
  const [group, setGroup] = useState(categoryId ?? "");

  return (
    <FormShell
      title={item ? `Edit ${item.name}` : "New item"}
      onSubmit={() =>
        tools.run(
          () =>
            saveItem({
              id: item?.id,
              categoryId: group || null,
              kind,
              name,
              price,
              priceUnit,
              description,
              available,
            }),
          () => tools.setEditing(null),
        )
      }
    >
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.2fr", gap: 10 }}>
        <label style={label}>
          Name
          <input autoFocus required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shirt" style={input} />
        </label>
        <label style={label}>
          Price (₹)
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Blank = on request"
            style={input}
          />
        </label>
        <label style={label}>
          Per
          <input maxLength={40} value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} placeholder="piece, kg, visit…" style={input} />
        </label>
        <label style={label}>
          In group
          <select value={group} onChange={(e) => setGroup(e.target.value)} style={input}>
            <option value="">No group</option>
            {tools.allGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ ...label, gridColumn: "1 / -1" }}>
          Description — what {tools.agentName} should know to talk about it: what is included, timings, sizes, conditions
          <textarea
            value={description}
            maxLength={4000}
            rows={3}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Steam pressed and returned on a hanger. Silk and embroidered shirts are ₹220."
            style={{ ...input, resize: "vertical" }}
          />
        </label>
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
        <span style={{ display: "flex", gap: 12 }}>
          {(["service", "product"] as const).map((k) => (
            <label key={k} style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
              <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
              {k === "service" ? "Service" : "Product"}
            </label>
          ))}
        </span>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} />
          Available now
        </label>
      </div>
      <FormButtons tools={tools} label={item ? "Save item" : "Add item"} />
    </FormShell>
  );
}
