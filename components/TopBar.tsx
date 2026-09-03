import { LiveDot } from "./ui";

/** The sticky 52px strip above every screen. */
export function TopBar({ live, waiting }: { live: number; waiting: number }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        background: "var(--color-bg)",
        borderBottom: "2px solid var(--color-divider)",
        height: 52,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 24px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-accent-700)",
        }}
      >
        <LiveDot />
        {live} call{live === 1 ? "" : "s"} live
      </div>
      <span style={{ height: 20, width: 1, background: "var(--color-neutral-300)" }} />
      <div
        style={{
          flex: 1,
          maxWidth: 420,
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          height: 30,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          color: "var(--color-neutral-700)",
          fontSize: 12.5,
        }}
      >
        <span>Search customers, calls, documents</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            fontWeight: 700,
            border: "1px solid var(--color-neutral-400)",
            padding: "1px 5px",
          }}
        >
          ⌘K
        </span>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          Waiting for a person <b style={{ color: "var(--color-accent-700)" }}>{waiting}</b>
        </span>
        <span style={{ height: 20, width: 1, background: "var(--color-neutral-300)" }} />
        <span style={{ fontSize: 11.5, fontWeight: 600 }}>
          {new Date().toLocaleString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}
