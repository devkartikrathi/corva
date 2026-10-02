import Link from "next/link";

/**
 * The 404.
 *
 * Corva has three surfaces with different grounds, and a person who lands here
 * arrived from one of them. Rather than guess which, this offers all three —
 * and says plainly that the address was wrong rather than implying they did
 * something wrong.
 */
export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div style={{ maxWidth: "48ch" }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-neutral-700)",
          }}
        >
          404
        </div>
        <h1
          style={{
            margin: "10px 0 0",
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: "-0.028em",
            lineHeight: 1.1,
          }}
        >
          There is nothing at this address.
        </h1>
        <p
          style={{
            marginTop: 14,
            fontSize: 13.5,
            lineHeight: 1.6,
            color: "var(--color-neutral-800)",
          }}
        >
          The link may be out of date, or the record it pointed at may have been removed. Nothing
          has gone wrong with your workspace.
        </p>
        <div style={{ marginTop: 22, display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            { href: "/app", label: "Command center" },
            { href: "/app/customers", label: "Customers" },
            { href: "/", label: "Corva home" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hov-invert"
              style={{
                fontSize: 12,
                fontWeight: 600,
                border: "2px solid var(--color-text)",
                padding: "8px 14px",
                color: "var(--color-text)",
              }}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
