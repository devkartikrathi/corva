"use client";

import { useState, useTransition } from "react";

/**
 * One axis weight.
 *
 * Stepped rather than a free slider, because the question a person is actually
 * asking is "does churn risk matter more than lifetime value here", and that
 * has about eight useful answers, not two hundred. Every change rescores the
 * brand immediately — a weight that does not move the queue until tomorrow is
 * a control nobody can learn from.
 */
const STOPS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function WeightDial({
  axisKey,
  label,
  weight,
  source,
  onChange,
}: {
  axisKey: string;
  label: string;
  weight: number;
  source: string;
  onChange: (axisKey: string, weight: number) => Promise<unknown>;
}) {
  const [optimistic, setOptimistic] = useState(weight);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms ease" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12.5 }}>
        <span style={{ flex: 1, color: "var(--color-neutral-800)" }}>{label}</span>
        <span style={{ fontSize: 10, color: "var(--color-neutral-500)" }}>{source}</span>
        <b style={{ width: 34, textAlign: "right" }}>{optimistic.toFixed(2)}</b>
      </div>
      <div style={{ marginTop: 5, display: "flex", gap: 2 }}>
        {STOPS.map((stop) => {
          const on = Math.abs(optimistic - stop) < 0.01;
          const filled = stop <= optimistic;
          return (
            <button
              key={stop}
              type="button"
              aria-label={`${label} weight ${stop}`}
              aria-pressed={on}
              disabled={pending}
              title={String(stop)}
              onClick={() => {
                setOptimistic(stop);
                setError(null);
                start(async () => {
                  try {
                    await onChange(axisKey, stop);
                  } catch (e) {
                    setOptimistic(weight);
                    setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
                  }
                });
              }}
              style={{
                flex: 1,
                height: 12,
                cursor: pending ? "progress" : "pointer",
                background: on
                  ? "var(--color-accent)"
                  : filled
                    ? "var(--color-text)"
                    : "var(--color-neutral-300)",
              }}
            />
          );
        })}
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 10.5, color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
