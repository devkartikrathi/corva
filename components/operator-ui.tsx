import type { CSSProperties, ReactNode } from "react";

/** Section eyebrow on the dark ground. */
export function DarkKicker({
  children,
  color = "var(--color-neutral-500)",
  size = 10,
  style,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
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

/** The screen header shared by every operator view. */
export function OperatorHeader({
  kicker,
  title,
  lede,
  children,
}: {
  kicker: string;
  title: string;
  lede?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        padding: "20px 24px",
        borderBottom: "2px solid var(--color-neutral-700)",
        display: "flex",
        alignItems: "flex-end",
        gap: 24,
      }}
    >
      <div>
        <DarkKicker>{kicker}</DarkKicker>
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
      {lede && (
        <p style={{ margin: "0 0 3px", fontSize: 12.5, color: "var(--color-neutral-400)", maxWidth: "48ch" }}>
          {lede}
        </p>
      )}
      {children && <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>{children}</div>}
    </div>
  );
}

/** A KPI cell in one of the top strips. */
export function KpiCell({
  label,
  value,
  note,
  delta,
  deltaColor,
  last = false,
}: {
  label: string;
  value: string;
  note?: string;
  delta?: string;
  deltaColor?: string;
  last?: boolean;
}) {
  return (
    <div
      style={{
        padding: "15px 18px",
        borderRight: last ? undefined : "1px solid var(--color-neutral-800)",
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-neutral-500)",
        }}
      >
        {label}
      </div>
      <div style={{ marginTop: 7, fontWeight: 800, fontSize: 26, lineHeight: 1, letterSpacing: "-0.025em" }}>
        {value}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: "var(--color-neutral-500)" }}>
        {delta && <b style={{ color: deltaColor }}>{delta} </b>}
        {note}
      </div>
    </div>
  );
}

/** Table header cell on the dark ground. */
export function DarkTh({
  children,
  width,
  padding = "9px 10px",
}: {
  children: ReactNode;
  width?: string | number;
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
        color: "var(--color-neutral-500)",
        width,
      }}
    >
      {children}
    </th>
  );
}

/** A 16px section heading inside an operator screen. */
export function DarkSectionTitle({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <h2 style={{ margin: 0, fontWeight: 800, fontSize: 16, letterSpacing: "-0.015em", ...style }}>
      {children}
    </h2>
  );
}
