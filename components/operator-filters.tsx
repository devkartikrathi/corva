import Link from "next/link";
import type { ReactNode } from "react";
import { href, listOf, toggleHref, toggleManyHref, type Params } from "@/lib/params";

/**
 * The operator console's list controls.
 *
 * The same URL-driven pieces as the tenant console, on the inverted palette.
 * Kept as a separate file rather than a `dark` prop on each because the two
 * consoles have different grounds, different neighbours and different hover
 * classes, and threading a boolean through every style object reads worse than
 * two small files.
 */

type Ctx = { pathname: string; params: Params };

export function DarkChip({
  ctx,
  paramKey,
  value,
  label,
  multi = false,
}: {
  ctx: Ctx;
  paramKey: string;
  value: string;
  label?: string;
  multi?: boolean;
}) {
  const on = multi ? listOf(ctx.params, paramKey).includes(value) : ctx.params[paramKey] === value;
  const to = multi
    ? toggleManyHref(ctx.pathname, ctx.params, paramKey, value)
    : toggleHref(ctx.pathname, ctx.params, paramKey, value);

  return (
    <Link
      href={to}
      className={on ? undefined : "hov-border-dark"}
      style={{
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${on ? "var(--color-bg)" : "var(--color-neutral-600)"}`,
        background: on ? "var(--color-bg)" : "transparent",
        color: on ? "var(--color-text)" : "var(--color-neutral-300)",
        padding: "4px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {label ?? value}
    </Link>
  );
}

export function DarkSortTh({
  ctx,
  field,
  children,
  width,
  padding = "9px 10px",
}: {
  ctx: Ctx;
  field: string;
  children: ReactNode;
  width?: string | number;
  padding?: string;
}) {
  const [active, dir] = (ctx.params.sort ?? "").split(":");
  const on = active === field;
  const next = on && dir !== "desc" ? `${field}:desc` : `${field}:asc`;

  return (
    <th style={{ textAlign: "left", padding, width }}>
      <Link
        href={href(ctx.pathname, ctx.params, { sort: next })}
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: on ? "var(--color-bg)" : "var(--color-neutral-500)",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        {children}
        <span style={{ opacity: on ? 1 : 0.3 }}>{on && dir === "desc" ? "↓" : "↑"}</span>
      </Link>
    </th>
  );
}

export function DarkSearchBox({
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
        border: "1px solid var(--color-neutral-600)",
        height: 30,
        padding: "0 9px",
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
          minWidth: 0,
          border: 0,
          outline: "none",
          background: "transparent",
          font: "inherit",
          fontSize: 12,
          color: "var(--color-bg)",
        }}
      />
      {current && (
        <Link
          href={href(ctx.pathname, ctx.params, { [paramKey]: null })}
          aria-label="Clear search"
          style={{ fontSize: 13, color: "var(--color-neutral-500)", lineHeight: 1 }}
        >
          ×
        </Link>
      )}
    </form>
  );
}

export function DarkPager({
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
      <span
        style={{
          padding: "4px 10px",
          border: "1px solid var(--color-neutral-800)",
          color: "var(--color-neutral-700)",
        }}
      >
        {label}
      </span>
    ) : (
      <Link
        href={href(ctx.pathname, ctx.params, { page: String(target) })}
        className="hov-border-dark"
        style={{
          padding: "4px 10px",
          border: "1px solid var(--color-neutral-600)",
          color: "var(--color-neutral-300)",
        }}
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
        borderTop: "1px solid var(--color-neutral-800)",
        fontSize: 11.5,
      }}
    >
      <span style={{ color: "var(--color-neutral-500)" }}>
        {from}–{to} of {total}
      </span>
      <span style={{ marginLeft: "auto", display: "flex", gap: 6, fontWeight: 600 }}>
        {step(-1, "← Previous")}
        {step(1, "Next →")}
      </span>
    </div>
  );
}
