/** The operator console's loading state, on the inverted palette. */
export default function OperatorLoading() {
  return (
    <div style={{ padding: "20px 24px" }} aria-busy="true" aria-label="Loading">
      <div
        style={{
          height: 11,
          width: 190,
          background: "var(--color-neutral-800)",
          animation: "cv-shimmer 1.4s ease-in-out infinite",
        }}
      />
      <div
        style={{
          marginTop: 12,
          height: 28,
          width: 240,
          background: "var(--color-neutral-800)",
          animation: "cv-shimmer 1.4s ease-in-out infinite 0.1s",
        }}
      />
      <div style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 12 }}>
        {Array.from({ length: 10 }, (_, i) => (
          <div
            key={i}
            style={{
              height: 15,
              width: `${94 - i * 5}%`,
              background: "var(--color-neutral-800)",
              animation: `cv-shimmer 1.4s ease-in-out infinite ${i * 0.05}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
