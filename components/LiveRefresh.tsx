"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Keeps a server-rendered screen current while something is happening.
 *
 * Polling rather than a pushed stream, and that is a constraint rather than a
 * preference: Next route handlers cannot hold a socket or an SSE connection
 * open — the docs are explicit that the connection closes on timeout or when
 * the response is generated. The voice bridge gets its own process for exactly
 * that reason, and standing up a second one to push console updates would be a
 * lot of machinery for a screen that is readable at three-second granularity.
 *
 * Three things keep it from being wasteful:
 *
 *   - it stops entirely when nothing is live, so a quiet workspace costs nothing
 *   - it stops when the tab is hidden, because nobody is reading it
 *   - `router.refresh()` re-runs the server components and diffs the result, so
 *     a poll that changes nothing repaints nothing and loses no scroll position
 */
export function LiveRefresh({
  active,
  intervalMs = 3000,
  label = "Live",
}: {
  /** Poll only while this is true — usually "is anything actually happening". */
  active: boolean;
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    if (!active || !visible) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = setInterval(() => {
      router.refresh();
      setTick((t) => t + 1);
    }, intervalMs);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [active, visible, intervalMs, router]);

  if (!active) return null;

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5 }}
      title={
        visible
          ? `Refreshing every ${intervalMs / 1000}s while this is open`
          : "Paused — this tab is in the background"
      }
    >
      <span
        style={{
          width: 6,
          height: 6,
          display: "block",
          background: visible ? "var(--color-accent)" : "var(--color-neutral-400)",
          animation: visible ? "cv-pulse 1.6s ease-in-out infinite" : undefined,
        }}
      />
      <span
        style={{
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: visible ? "var(--color-accent-700)" : "var(--color-neutral-700)",
        }}
      >
        {visible ? label : "Paused"}
      </span>
      <span style={{ color: "var(--color-neutral-500)" }} aria-hidden>
        {tick > 0 ? `· ${tick}` : ""}
      </span>
    </span>
  );
}
