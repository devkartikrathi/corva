import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/* ─── Type ─────────────────────────────────────────────────────────────── */

/** The 9.5–10px tracked-out uppercase label that titles every panel. */
export function Kicker({
  children,
  color = "var(--color-neutral-700)",
  size = 10,
  style,
}: {
  children: ReactNode;
  color?: string;
  size?: 9.5 | 10 | 11;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The screen title block: kicker over a 30px heading. */
export function ScreenTitle({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div>
      <Kicker>{kicker}</Kicker>
      <h1
        style={{
          margin: "8px 0 0",
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: "-0.028em",
          lineHeight: 1,
        }}
      >
        {title}
      </h1>
    </div>
  );
}

/** A 16–17px section heading inside a screen. */
export function SectionTitle({
  children,
  size = 17,
}: {
  children: ReactNode;
  size?: 16 | 17 | 21 | 22;
}) {
  return (
    <h2 style={{ margin: 0, fontWeight: 800, fontSize: size, letterSpacing: "-0.015em" }}>
      {children}
    </h2>
  );
}

/* ─── Buttons ──────────────────────────────────────────────────────────── */

type ButtonBase = { children: ReactNode; href?: string; style?: CSSProperties };

function styled(className: string, style: CSSProperties, p: ButtonBase) {
  const merged = { ...style, ...p.style };
  return p.href ? (
    <Link href={p.href} className={className} style={merged}>
      {p.children}
    </Link>
  ) : (
    <button type="button" className={className} style={merged}>
      {p.children}
    </button>
  );
}

/** Solid accent call to action. */
export function PrimaryButton(p: ButtonBase) {
  return styled("hov-accent", {
    display: "inline-block",
    fontSize: 12,
    fontWeight: 700,
    background: "var(--color-accent)",
    color: "var(--color-bg)",
    padding: "10px 14px",
  }, p);
}

/** Ink-outlined secondary action; inverts on hover. */
export function OutlineButton(p: ButtonBase) {
  return styled("hov-invert", {
    display: "inline-block",
    fontSize: 12,
    fontWeight: 600,
    border: "2px solid var(--color-text)",
    padding: "8px 14px",
  }, p);
}


/** The bare accent text link that ends most panel headers. */
export function LinkAction(p: ButtonBase & { size?: number }) {
  const { size = 11.5, ...rest } = p;
  return styled("", {
    fontSize: size,
    fontWeight: 700,
    color: "var(--color-accent-700)",
    textAlign: "left",
  }, rest);
}

/* ─── Indicators ───────────────────────────────────────────────────────── */

/** The pulsing accent square that marks anything live. */
export function LiveDot({ size = 7 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        background: "var(--color-accent)",
        display: "block",
        animation: "cv-pulse 1.6s ease-in-out infinite",
      }}
    />
  );
}

/** A filled pill. Colours come from the data layer. */
export function Tag({
  children,
  bg,
  fg,
  size = 10,
  padding = "3px 7px",
}: {
  children: ReactNode;
  bg: string;
  fg: string;
  size?: number;
  padding?: string;
}) {
  return (
    <span
      style={{
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        background: bg,
        color: fg,
        padding,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/**
 * A horizontal meter. `marker` draws the tick the filter and weight sliders
 * use to show the handle or a comparison median.
 */
export function Bar({
  width,
  color,
  height = 6,
  track = "var(--color-neutral-300)",
  marker,
  markerAt,
  markerColor = "var(--color-text)",
  style,
}: {
  width: string;
  color: string;
  height?: number;
  track?: string;
  marker?: "handle" | "median";
  markerAt?: string;
  markerColor?: string;
  style?: CSSProperties;
}) {
  const at = markerAt ?? width;
  return (
    <div style={{ height, background: track, position: "relative", ...style }}>
      <span style={{ position: "absolute", insetInlineStart: 0, top: 0, bottom: 0, width, background: color }} />
      {marker === "handle" && (
        <span style={{ position: "absolute", left: at, top: -3, width: 3, height: height + 6, background: markerColor }} />
      )}
      {marker === "median" && (
        <span style={{ position: "absolute", left: at, top: -2, width: 1, height: height + 4, background: markerColor }} />
      )}
    </div>
  );
}

/** A square checkbox glyph — checked squares fill with accent. */
export function CheckSquare({ on }: { on: boolean }) {
  return (
    <span
      style={{
        width: 14,
        height: 14,
        border: `2px solid ${on ? "var(--color-text)" : "var(--color-neutral-400)"}`,
        background: on ? "var(--color-accent)" : "transparent",
        display: "block",
        flexShrink: 0,
      }}
    />
  );
}

/* ─── Layout ───────────────────────────────────────────────────────────── */

/** The header strip that opens every screen. */
export function ScreenHeader({
  kicker,
  title,
  lede,
  children,
  border = true,
  padding = "20px 24px",
}: {
  kicker: string;
  title: string;
  lede?: string;
  children?: ReactNode;
  border?: boolean;
  padding?: string;
}) {
  return (
    <div
      style={{
        padding,
        borderBottom: border ? "2px solid var(--color-divider)" : undefined,
        display: "flex",
        alignItems: "flex-end",
        gap: 24,
      }}
    >
      <ScreenTitle kicker={kicker} title={title} />
      {lede && (
        <p style={{ margin: "0 0 3px", fontSize: 12.5, color: "var(--color-neutral-800)", maxWidth: "46ch" }}>
          {lede}
        </p>
      )}
      {children && <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{children}</div>}
    </div>
  );
}


/** A label/value row — the workhorse of every rail and detail list. */
export function StatRow({
  label,
  value,
  valueColor,
  labelWidth,
}: {
  label: ReactNode;
  value: ReactNode;
  valueColor?: string;
  labelWidth?: number;
}) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
      <span style={{ flex: labelWidth ? undefined : 1, width: labelWidth, color: "var(--color-neutral-800)" }}>
        {label}
      </span>
      <b style={{ color: valueColor }}>{value}</b>
    </div>
  );
}

/** A `from → to` comparison row, used by both simulation panels. */
export function DeltaRow({
  label,
  from,
  to,
  hot,
}: {
  label: string;
  from: string;
  to: string;
  hot: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
      <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{label}</span>
      <b>
        {from} →{" "}
        <span style={{ color: hot ? "var(--color-accent-700)" : "var(--color-neutral-800)" }}>{to}</span>
      </b>
    </div>
  );
}

/* ─── Tables ───────────────────────────────────────────────────────────── */

/** A table header cell in the console's tracked-out uppercase style. */
export function Th({
  children,
  width,
  padding = "8px 10px",
}: {
  children: ReactNode;
  width?: number;
  padding?: string;
}) {
  return (
    <th
      style={{
        textAlign: "left",
        padding,
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--color-neutral-700)",
        width,
      }}
    >
      {children}
    </th>
  );
}

/** A stacked bar column: human above, AI below, both as percentages. */
export function StackedBar({ ai, human, gap = 2 }: { ai: string; human: string; gap?: number }) {
  return (
    <span
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        height: "100%",
        gap,
      }}
    >
      <span style={{ display: "block", background: "var(--color-neutral-400)", height: human }} />
      <span style={{ display: "block", background: "var(--color-accent)", height: ai }} />
    </span>
  );
}

/** The two-swatch legend under the containment charts. */
export function ChartLegend({ style }: { style?: CSSProperties }) {
  const swatch = (bg: string) => (
    <span style={{ width: 10, height: 10, background: bg, display: "block" }} />
  );
  return (
    <span style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--color-neutral-700)", ...style }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {swatch("var(--color-accent)")}AI finished it
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {swatch("var(--color-neutral-400)")}Human needed
      </span>
    </span>
  );
}
