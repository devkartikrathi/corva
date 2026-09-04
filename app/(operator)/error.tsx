"use client";

import { useEffect } from "react";

/**
 * The operator console's error boundary, on the inverted palette.
 *
 * Every screen here is one database away from failing, and the default is a
 * blank page that tells a person nothing and offers them nothing. This says
 * what broke, keeps the digest so it can be found in the logs, and gives them
 * a way out that is not the back button.
 *
 * It does not print the raw message in production — Next redacts server error
 * text on purpose, and inventing a friendlier lie in its place would be worse.
 */
export default function OperatorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("operator console error:", error);
  }, [error]);

  return (
    <section style={{ padding: "48px 24px", maxWidth: "62ch" }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-accent-400)",
        }}
      >
        Something failed
      </div>
      <h1
        style={{
          margin: "10px 0 0",
          fontWeight: 800,
          fontSize: 28,
          letterSpacing: "-0.028em",
          lineHeight: 1.1,
        }}
      >
        This screen could not load.
      </h1>
      <p style={{ marginTop: 14, fontSize: 13.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
        Nothing you were looking at has changed — the console failed to read it, not to save it.
        Trying again is usually enough; if it is not, the reference below identifies this exact
        failure in the logs.
      </p>
      {error.digest && (
        <p style={{ marginTop: 12, fontSize: 12, color: "var(--color-neutral-700)" }}>
          Reference <code style={{ color: "var(--color-text)", fontWeight: 700 }}>{error.digest}</code>
        </p>
      )}
      <div style={{ marginTop: 22, display: "flex", gap: 8 }}>
        <button
          type="button"
          className="hov-accent-dark"
          onClick={reset}
          style={{
            fontSize: 12,
            fontWeight: 700,
            background: "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "10px 14px",
          }}
        >
          Try again
        </button>
        <a
          href="/operator"
          className="hov-invert-dark"
          style={{
            fontSize: 12,
            fontWeight: 600,
            border: "2px solid var(--color-bg)",
            padding: "8px 14px",
            color: "var(--color-bg)",
          }}
        >
          Back to the fleet
        </a>
      </div>
    </section>
  );
}
