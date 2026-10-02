"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { IncomingTransfer } from "@/lib/queries/transfers";

/**
 * The AI asking for you, by name.
 *
 * Before this existed the handoff queue was a screen you had to be looking at.
 * The AI would reach a limit, write a brief, queue a person — and that person
 * found out whenever they next clicked Handoffs, which on a live call is far
 * too late. This is the missing half: the console interrupts you, wherever you
 * are in it, and gives you the three things you need to decide in about three
 * seconds — who is calling, what they want, and how long they have waited.
 *
 * What it deliberately does not do is show you the brief. The brief is a
 * screen's worth of reading, and reading it is what you do *after* you have
 * taken the line and told the customer you are here. The one line above the
 * buttons is the whole point: a colleague should be able to say the opening
 * sentence without having read anything else.
 *
 * Declining is a real answer, not a snooze. It re-routes to the next person
 * and records that you passed, so it will not come straight back to you.
 */

/** Fast enough that a live customer is not waiting on the poll interval. */
const POLL_MS = 4000;

export function TransferAlert({
  onAccept,
  onDecline,
}: {
  onAccept: (handoffId: string) => Promise<{ conversationId: string }>;
  onDecline: (handoffId: string) => Promise<{ reroutedTo: string | null }>;
}) {
  const router = useRouter();
  const [transfer, setTransfer] = useState<IncomingTransfer | null>(null);
  const [busy, setBusy] = useState<null | "accept" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Handoffs this tab has already answered.
   *
   * The poll and the server action race: accepting writes the row, but the
   * next poll can be in flight with the old answer already on its way back.
   * Without this the card flashes back up for a second after you take it.
   */
  const answered = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const res = await fetch("/api/transfers", { cache: "no-store" });
      if (!res.ok) return;
      const { transfers } = (await res.json()) as { transfers: IncomingTransfer[] };
      const next = transfers.find((t) => !answered.current.has(t.handoffId)) ?? null;
      setTransfer((current) =>
        // Don't swap the card out from under someone mid-decision.
        current && busy ? current : next,
      );
    } catch {
      // A failed poll is not worth telling anyone about; the next one is in
      // four seconds and the handoff is still in the queue either way.
    }
  }, [busy]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    const onVisible = () => void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  if (!transfer) return null;

  const closure = transfer.kind === "closure_approval";

  const accept = async () => {
    setBusy("accept");
    setError(null);
    try {
      const { conversationId } = await onAccept(transfer.handoffId);
      answered.current.add(transfer.handoffId);
      setTransfer(null);
      router.push(`/app/live?call=${conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take that call.");
    } finally {
      setBusy(null);
    }
  };

  const decline = async () => {
    setBusy("decline");
    setError(null);
    try {
      await onDecline(transfer.handoffId);
      answered.current.add(transfer.handoffId);
      setTransfer(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not pass that on.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label={`${transfer.customerName} — ${closure ? "closed by agreement" : "transfer from the AI"}`}
      className="cv-alert" style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        zIndex: 100,
        width: 384,
        background: "var(--color-bg)",
        border: "2px solid var(--color-text)",
        boxShadow: "0 18px 44px rgba(0,0,0,0.22)",
        animation: "cv-rise 220ms ease-out",
      }}
    >
      {/* Header: who, and how urgently */}
      <div
        style={{
          padding: "11px 16px",
          background: closure ? "var(--color-text)" : "var(--color-accent)",
          color: "var(--color-bg)",
          display: "flex",
          alignItems: "center",
          gap: 9,
        }}
      >
        {transfer.live && !closure && (
          <span
            style={{
              width: 8,
              height: 8,
              display: "block",
              background: "var(--color-bg)",
              animation: "cv-pulse 1s ease-in-out infinite",
            }}
          />
        )}
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          {closure
            ? "Closed by agreement · needs sign-off"
            : transfer.live
              ? "The AI is transferring a live call"
              : "The AI needs a person"}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, opacity: 0.85 }}>
          {transfer.wait}
        </span>
      </div>

      <div style={{ padding: "14px 16px 16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <b style={{ fontSize: 16.5, letterSpacing: "-0.02em" }}>{transfer.customerName}</b>
          <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
            {transfer.channel} · P{transfer.priority} · {transfer.value}
          </span>
        </div>

        {/* The one line. This is what the alert exists for. */}
        <p
          style={{
            margin: "10px 0 0",
            padding: "10px 12px",
            background: "var(--color-surface)",
            borderLeft: "3px solid var(--color-text)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          {transfer.summary ?? transfer.reason}
        </p>

        {transfer.openingLine && !closure && (
          <p
            style={{
              margin: "9px 0 0",
              fontSize: 12,
              lineHeight: 1.5,
              color: "var(--color-neutral-800)",
            }}
          >
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--color-neutral-500)",
                display: "block",
                marginBottom: 3,
              }}
            >
              Open with
            </span>
            &ldquo;{transfer.openingLine}&rdquo;
          </p>
        )}

        <div style={{ marginTop: 9, fontSize: 11, color: "var(--color-neutral-700)" }}>
          {transfer.routedAtYou
            ? (transfer.routingReason ?? "Routed to you")
            : "Open to anyone free"}
        </div>

        {error && (
          <div role="alert" style={{ marginTop: 9, fontSize: 11.5, color: "var(--color-accent-700)" }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 13, display: "flex", gap: 8 }}>
          <button
            type="button"
            className="hov-accent"
            onClick={accept}
            disabled={busy !== null}
            style={{
              flex: 1,
              fontSize: 12.5,
              fontWeight: 700,
              padding: "10px 12px",
              background: "var(--color-text)",
              color: "var(--color-bg)",
              cursor: busy ? "progress" : "pointer",
              opacity: busy === "decline" ? 0.5 : 1,
            }}
          >
            {busy === "accept" ? "Taking…" : closure ? "Review it" : "Take the line"}
          </button>
          <button
            type="button"
            className="hov-invert"
            onClick={decline}
            disabled={busy !== null}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              padding: "9px 12px",
              border: "1px solid var(--color-text)",
              color: "var(--color-text)",
              cursor: busy ? "progress" : "pointer",
              opacity: busy === "accept" ? 0.5 : 1,
            }}
          >
            {busy === "decline" ? "Passing…" : "Pass on"}
          </button>
        </div>
      </div>
    </div>
  );
}
