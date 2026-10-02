import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { href, listOf, toggleHref, toggleManyHref, type Params } from "@/lib/params";
import { CheckSquare } from "./ui";

/**
 * The list-screen controls.
 *
 * All of them are links. A filter changes the URL, the server re-renders the
 * table from the new query, and the back button undoes it — so there is no
 * client-side filter state that can disagree with what the rows actually are.
 * The one exception is `SearchBox`, which is a GET form because typing needs
 * an input; it still ends at the same URL a chip would produce.
 */

type Ctx = { pathname: string; params: Params };

/* ─── Tabs ─────────────────────────────────────────────────────────────── */

/** The underlined tab strip above a table. */
export function TabStrip({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        padding: "0 24px",
        display: "flex",
        borderBottom: "2px solid var(--color-divider)",
        fontSize: 12.5,
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Tab({
  label,
  href: to,
  current,
  count,
}: {
  label: string;
  href: string;
  current: boolean;
  count?: number;
}) {
  return current ? (
    <span
      style={{
        padding: "9px 14px",
        borderBottom: "3px solid var(--color-accent)",
        marginBottom: -2,
        display: "flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{count}</span>
      )}
    </span>
  ) : (
    <Link
      href={to}
      className="hov-ink"
      style={{
        padding: "9px 14px",
        color: "var(--color-neutral-700)",
        display: "flex",
        alignItems: "center",
        gap: 7,
      }}
    >
      {label}
      {count !== undefined && <span style={{ fontSize: 11 }}>{count}</span>}
    </Link>
  );
}

/* ─── Chips ────────────────────────────────────────────────────────────── */

/**
 * A single-select filter chip. Selecting the chip that is already on clears
 * the filter, which is what people expect from a toggle and saves a separate
 * "any" option in most groups.
 */
export function Chip({
  ctx,
  paramKey,
  value,
  label,
  multi = false,
}: Ctx extends never ? never : {
  ctx: Ctx;
  paramKey: string;
  value: string;
  label?: string;
  /** Treat the key as a comma-separated list rather than one value. */
  multi?: boolean;
}) {
  const on = multi
    ? listOf(ctx.params, paramKey).includes(value)
    : ctx.params[paramKey] === value;
  const to = multi
    ? toggleManyHref(ctx.pathname, ctx.params, paramKey, value)
    : toggleHref(ctx.pathname, ctx.params, paramKey, value);

  return (
    <Link
      href={to}
      className={on ? undefined : "hov-border"}
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        padding: "4px 9px",
        border: `1px solid ${on ? "var(--color-text)" : "var(--color-neutral-400)"}`,
        background: on ? "var(--color-text)" : "transparent",
        color: on ? "var(--color-bg)" : "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {label ?? value}
    </Link>
  );
}

/** A checkbox row, for filter rails where the options are stacked. */
export function CheckFilter({
  ctx,
  paramKey,
  value,
  label,
  aside,
}: {
  ctx: Ctx;
  paramKey: string;
  value: string;
  label: string;
  aside?: ReactNode;
}) {
  const on = listOf(ctx.params, paramKey).includes(value);
  return (
    <Link
      href={toggleManyHref(ctx.pathname, ctx.params, paramKey, value)}
      className="hov-ink"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        fontSize: 12.5,
        color: on ? "var(--color-text)" : "var(--color-neutral-800)",
        fontWeight: on ? 600 : 400,
      }}
    >
      <CheckSquare on={on} />
      <span style={{ flex: 1 }}>{label}</span>
      {aside}
    </Link>
  );
}

/* ─── Search ───────────────────────────────────────────────────────────── */

/**
 * A GET form. Hidden inputs carry the rest of the query, so searching inside
 * a filtered view keeps the filter rather than silently resetting it.
 */
export function SearchBox({
  ctx,
  placeholder = "Search",
  paramKey = "q",
  width,
}: {
  ctx: Ctx;
  placeholder?: string;
  paramKey?: string;
  width?: number | string;
}) {
  const { [paramKey]: current, page: _page, ...rest } = ctx.params;
  return (
    <form
      action={ctx.pathname}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        border: "1px solid var(--color-neutral-400)",
        background: "var(--color-surface)",
        height: 28,
        padding: "0 8px",
        width,
      }}
    >
      {Object.entries(rest).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input
        type="search"
        name={paramKey}
        defaultValue={current ?? ""}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{
          flex: 1,
          border: 0,
          outline: "none",
          background: "transparent",
          font: "inherit",
          fontSize: 12.5,
          color: "inherit",
          minWidth: 0,
        }}
      />
      {current && (
        <Link
          href={href(ctx.pathname, ctx.params, { [paramKey]: null })}
          aria-label="Clear search"
          style={{ fontSize: 13, color: "var(--color-neutral-700)", lineHeight: 1 }}
        >
          ×
        </Link>
      )}
    </form>
  );
}

/* ─── Sorting and paging ───────────────────────────────────────────────── */

/** A sortable column header. Clicking the active column reverses it. */
export function SortTh({
  ctx,
  field,
  children,
  width,
  align = "left",
}: {
  ctx: Ctx;
  field: string;
  children: ReactNode;
  width?: number;
  align?: "left" | "right";
}) {
  const [active, dir] = (ctx.params.sort ?? "").split(":");
  const on = active === field;
  const next = on && dir !== "asc" ? `${field}:asc` : `${field}:desc`;

  return (
    <th style={{ textAlign: align, padding: "8px 10px", width }}>
      <Link
        href={href(ctx.pathname, ctx.params, { sort: next })}
        className="hov-ink"
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: on ? "var(--color-text)" : "var(--color-neutral-700)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {children}
        <span style={{ opacity: on ? 1 : 0.25 }}>{on && dir === "asc" ? "↑" : "↓"}</span>
      </Link>
    </th>
  );
}

export function Pager({
  ctx,
  page,
  pageSize,
  total,
}: {
  ctx: Ctx;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const step = (delta: number, label: string) => {
    const target = page + delta;
    const disabled = target < 1 || target > pages;
    return disabled ? (
      <span style={{ padding: "4px 10px", border: "1px solid var(--color-neutral-300)", color: "var(--color-neutral-500)" }}>
        {label}
      </span>
    ) : (
      <Link
        href={href(ctx.pathname, ctx.params, { page: String(target) })}
        className="hov-border"
        style={{ padding: "4px 10px", border: "1px solid var(--color-neutral-400)" }}
      >
        {label}
      </Link>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 24px",
        borderTop: "1px solid var(--color-neutral-300)",
        fontSize: 11.5,
      }}
    >
      <span style={{ color: "var(--color-neutral-700)" }}>
        {from}–{to} of {total}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 6, fontSize: 11.5, fontWeight: 600 }}>
        {step(-1, "← Previous")}
        {step(1, "Next →")}
      </span>
    </div>
  );
}

/** The "3 filters · Reset" line every rail ends with. */
export function ActiveFilters({
  ctx,
  ignore = ["page", "sort", "view"],
}: {
  ctx: Ctx;
  ignore?: string[];
}) {
  const active = Object.keys(ctx.params).filter((k) => !ignore.includes(k));
  if (active.length === 0) {
    return <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>No filters</span>;
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ color: "var(--color-neutral-700)" }}>
        {active.length} filter{active.length === 1 ? "" : "s"}
      </span>
      <Link href={ctx.pathname} style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
        Reset
      </Link>
    </span>
  );
}
