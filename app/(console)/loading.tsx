/**
 * The console's loading state.
 *
 * Every screen here opens with several round trips to a database that is not
 * in this building — 300ms to 1s each, in testing. Without a boundary the
 * browser holds the previous screen while that happens, which reads as a
 * click that did nothing.
 *
 * Deliberately a skeleton of the shape that is coming rather than a spinner:
 * the layout does not jump when the real thing arrives.
 */
export default function ConsoleLoading() {
  return (
    <div style={{ padding: "24px 24px 0" }} aria-busy="true" aria-label="Loading">
      <div
        style={{
          height: 11,
          width: 150,
          background: "var(--color-neutral-300)",
          animation: "cv-shimmer 1.4s ease-in-out infinite",
        }}
      />
      <div
        style={{
          marginTop: 12,
          height: 30,
          width: 300,
          background: "var(--color-neutral-300)",
          animation: "cv-shimmer 1.4s ease-in-out infinite 0.1s",
        }}
      />
      <div
        className="cv-tiles" style={{
          marginTop: 26,
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 1,
          borderTop: "2px solid var(--color-divider)",
          borderBottom: "2px solid var(--color-divider)",
        }}
      >
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} style={{ padding: "16px 20px" }}>
            <div
              style={{
                height: 9,
                width: "70%",
                background: "var(--color-neutral-300)",
                animation: `cv-shimmer 1.4s ease-in-out infinite ${i * 0.06}s`,
              }}
            />
            <div
              style={{
                marginTop: 10,
                height: 26,
                width: "45%",
                background: "var(--color-neutral-300)",
                animation: `cv-shimmer 1.4s ease-in-out infinite ${i * 0.06 + 0.1}s`,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 11 }}>
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            style={{
              height: 15,
              width: `${92 - i * 6}%`,
              background: "var(--color-neutral-300)",
              animation: `cv-shimmer 1.4s ease-in-out infinite ${i * 0.05}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
