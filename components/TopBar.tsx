import Link from "next/link";
import { AccountMenu } from "./AccountMenu";
import { LiveDot } from "./ui";

/** The sticky 52px strip above every screen. */
export function TopBar({ live, waiting, signedIn = false }: { live: number; waiting: number; signedIn?: boolean }) {
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
      <Link
        href="/app/live"
        className="hov-ink"
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
      </Link>
      <span style={{ height: 20, width: 1, background: "var(--color-neutral-300)" }} />
      {/* A GET form, so a search is a URL you can share and go back from. */}
      <form
        action="/app/search"
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
          fontSize: 12.5,
        }}
      >
        <input
          type="search"
          name="q"
          placeholder="Search customers, calls, documents"
          aria-label="Search customers, calls, documents"
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            outline: "none",
            background: "transparent",
            font: "inherit",
            fontSize: 12.5,
            color: "inherit",
          }}
        />
        <button
          type="submit"
          style={{
            fontSize: 10,
            fontWeight: 700,
            border: "1px solid var(--color-neutral-400)",
            padding: "1px 5px",
            color: "var(--color-neutral-700)",
          }}
        >
          Go
        </button>
      </form>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <Link href="/app/handoffs" className="hov-ink" style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
          Waiting for a person <b style={{ color: "var(--color-accent-700)" }}>{waiting}</b>
        </Link>
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
        {signedIn && (
          <>
            <span style={{ height: 20, width: 1, background: "var(--color-neutral-300)" }} />
            <AccountMenu />
          </>
        )}
      </div>
    </div>
  );
}
