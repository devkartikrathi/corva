"use client";

import { useState, useTransition } from "react";

/**
 * The two controls attendance needs: a person starting and ending their own
 * day, and a manager recording someone else's.
 */

const STATUSES = [
  { value: "present", label: "Present" },
  { value: "half_day", label: "Half day" },
  { value: "leave", label: "On leave" },
  { value: "absent", label: "Absent" },
] as const;

export function ClockButton({
  open,
  since,
  worked,
  onStart,
  onEnd,
}: {
  /** Clocked in, and not yet out. */
  open: boolean;
  since: string | null;
  worked: string;
  onStart: () => Promise<void>;
  onEnd: () => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setFailed(false);
      try {
        await fn();
      } catch {
        setFailed(true);
      }
    });

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 12 }}>
      <span style={{ color: "var(--color-neutral-700)" }}>
        {failed ? "That did not save. Try again." : open ? `At work since ${since}${worked ? ` · ${worked}` : ""}` : since ? `Worked ${worked || "under a minute"} today` : "Not clocked in today"}
      </span>
      <button
        type="button"
        className={open ? "hov-invert" : "hov-accent"}
        disabled={pending}
        onClick={() => run(open ? onEnd : onStart)}
        style={{
          fontSize: 11.5,
          fontWeight: 700,
          padding: "8px 13px",
          cursor: "pointer",
          opacity: pending ? 0.6 : 1,
          ...(open
            ? { border: "1px solid var(--color-neutral-400)" }
            : { background: "var(--color-accent)", color: "var(--color-bg)" }),
        }}
      >
        {open ? "End my day" : since ? "Back at work" : "Start my day"}
      </button>
    </span>
  );
}

export function MarkDay({
  status,
  onMark,
}: {
  /** What is recorded now, or nothing. */
  status: string | null;
  onMark: (status: "present" | "half_day" | "leave" | "absent") => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="Record this day"
      value={status ?? ""}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as "present" | "half_day" | "leave" | "absent";
        if (next) start(() => onMark(next).catch(() => {}));
      }}
      style={{
        fontSize: 10.5,
        fontFamily: "inherit",
        border: "1px solid var(--color-neutral-400)",
        background: "var(--color-surface)",
        color: "var(--color-text)",
        padding: "2px 3px",
        borderRadius: 0,
        opacity: pending ? 0.5 : 1,
        maxWidth: "100%",
      }}
    >
      {!status && <option value="">Mark…</option>}
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
