"use client";

import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Chat to a business as a customer would.
 *
 * The same shape as the dialer — pick the business, choose who you are — but
 * typed. Each reply comes from the same pipeline a real web chat uses, and
 * what the AI records along the way (a lead, a follow-up, a handoff) is shown
 * inline, so the demo does not need a second screen to prove it happened.
 */

type Line =
  | { kind: "you"; text: string }
  | { kind: "ai"; text: string }
  | { kind: "person"; name: string; text: string }
  | { kind: "note"; text: string; accent?: boolean };

type Business = { brandId: string; business: string; agentName: string | null; number: string };

const LABEL: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--color-neutral-500)",
  marginBottom: 8,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--color-neutral-600)",
  background: "transparent",
  color: "var(--color-bg)",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  borderRadius: 0,
};

const freshMobile = () =>
  `+91 9${String(Math.floor(Math.random() * 10000)).padStart(4, "0")} ${String(Math.floor(Math.random() * 100000)).padStart(5, "0")}`;

const message = (e: unknown) =>
  e instanceof Error && !e.message.startsWith("Minified React error")
    ? e.message.replace(/^Error:\s*/, "")
    : "That did not go through. Try again.";

export function ChatTester({
  businesses,
  callers,
  initialBrandId,
  onStart,
  onSend,
  onPoll,
  onEnd,
}: {
  businesses: Business[];
  callers: Record<string, { name: string; phone: string; detail: string }[]>;
  initialBrandId?: string;
  onStart: (input: { brandId: string; callerPhone: string; countsInMetrics: boolean }) => Promise<{
    conversationId: string;
    agentName: string;
    business: string;
    recognised: string | null;
  }>;
  onSend: (conversationId: string, message: string) => Promise<{
    text: string | null;
    heldBy: string | null;
    actions: { label: string; allowed: boolean }[];
    escalation: { reason: string; routedTo: string | null } | null;
    closed: boolean;
  }>;
  onPoll: (
    conversationId: string,
    afterOrdinal: number,
  ) => Promise<{
    turns: { ordinal: number; speaker: string; author: string | null; body: string }[];
    lastOrdinal: number;
    heldBy: string | null;
    ended: boolean;
  }>;
  onEnd: (conversationId: string) => Promise<void>;
}) {
  const [brandId, setBrandId] = useState(initialBrandId ?? businesses[0]?.brandId ?? "");
  const [callerPhone, setCallerPhone] = useState("");
  useEffect(() => setCallerPhone((p) => p || freshMobile()), []);
  const [counts, setCounts] = useState(true);
  const [chat, setChat] = useState<{ id: string; agent: string; business: string } | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const lastOrdinal = useRef(-1);
  const log = useRef<HTMLDivElement | null>(null);

  const known = callers[brandId] ?? [];
  const business = businesses.find((b) => b.brandId === brandId);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  // While a chat is open, pick up whatever a person on the console types.
  useEffect(() => {
    if (!chat) return;
    const timer = setInterval(async () => {
      try {
        const r = await onPoll(chat.id, lastOrdinal.current);
        lastOrdinal.current = Math.max(lastOrdinal.current, r.lastOrdinal);
        if (r.turns.length) {
          setLines((prev) => [
            ...prev,
            ...r.turns.map((t): Line =>
              t.speaker === "human"
                ? { kind: "person", name: t.author ?? "A colleague", text: t.body }
                : { kind: "note", text: t.body },
            ),
          ]);
        }
        if (r.ended) {
          setLines((prev) => [...prev, { kind: "note", text: "The chat was closed from the console." }]);
          setChat(null);
        }
      } catch {
        // The next poll will try again.
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [chat, onPoll]);

  const begin = () => {
    setError(null);
    start(async () => {
      try {
        const r = await onStart({ brandId, callerPhone, countsInMetrics: counts });
        setChat({ id: r.conversationId, agent: r.agentName, business: r.business });
        lastOrdinal.current = -1;
        setLines([
          {
            kind: "note",
            text: `Chatting with ${r.agentName} at ${r.business}. ${r.recognised ? `They know you as ${r.recognised}.` : "You are a new customer — they do not know you yet."}`,
          },
        ]);
      } catch (e) {
        setError(message(e));
      }
    });
  };

  const send = () => {
    const text = draft.trim();
    if (!chat || !text) return;
    setDraft("");
    setError(null);
    setLines((prev) => [...prev, { kind: "you", text }]);
    start(async () => {
      try {
        const r = await onSend(chat.id, text);
        const extra: Line[] = [];
        if (r.text) extra.push({ kind: "ai", text: r.text });
        for (const a of r.actions) extra.push({ kind: "note", text: `${chat.agent} recorded · ${a.label}`, accent: a.allowed });
        if (r.escalation) {
          extra.push({
            kind: "note",
            text: `Handed to a person${r.escalation.routedTo ? ` — ringing ${r.escalation.routedTo}` : ""}: ${r.escalation.reason}`,
            accent: true,
          });
        }
        if (r.heldBy) extra.push({ kind: "note", text: `${r.heldBy} has the chat; the AI is not replying.` });
        if (r.closed) extra.push({ kind: "note", text: "Closed by agreement." });
        setLines((prev) => [...prev, ...extra]);
        // Our own message and the reply are already on screen; skip them in polling.
        const polled = await onPoll(chat.id, Number.MAX_SAFE_INTEGER);
        lastOrdinal.current = polled.lastOrdinal;
      } catch (e) {
        setError(message(e));
      }
    });
  };

  const end = () => {
    if (!chat) return;
    const id = chat.id;
    setChat(null);
    setLines((prev) => [...prev, { kind: "note", text: "You ended the chat." }]);
    start(async () => {
      try {
        await onEnd(id);
      } catch (e) {
        setError(message(e));
      }
    });
  };

  return (
    <div className="m-stack m-auto-h" style={{ display: "grid", gridTemplateColumns: "1fr 340px", minHeight: 520 }}>
      <div className="m-noborder-x" style={{ borderRight: "2px solid var(--color-neutral-700)", display: "flex", flexDirection: "column" }}>
        <div ref={log} style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12, maxHeight: 470 }}>
          {lines.length === 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-neutral-500)", lineHeight: 1.6, maxWidth: "56ch" }}>
              Pick a business and press <b style={{ color: "var(--color-bg)" }}>Start chatting</b>. Try saying who you are
              and what you want, then ask for a callback — the lead and the follow-up appear here and on the
              business&rsquo;s console.
            </p>
          )}
          {lines.map((l, i) =>
            l.kind === "note" ? (
              <div key={i} style={{ fontSize: 11.5, fontStyle: "italic", color: l.accent ? "var(--color-accent-400)" : "var(--color-neutral-500)" }}>
                {l.text}
              </div>
            ) : (
              <div key={i} className="cv-turn" style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 12 }}>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: l.kind === "you" ? "var(--color-neutral-500)" : l.kind === "ai" ? "var(--color-accent-400)" : "var(--color-bg)",
                    paddingTop: 3,
                  }}
                >
                  {l.kind === "you" ? "You" : l.kind === "ai" ? (chat?.agent ?? "AI") : l.name.split(" ")[0]}
                </span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--color-bg)", whiteSpace: "pre-wrap" }}>{l.text}</span>
              </div>
            ),
          )}
          {pending && chat && <div style={{ fontSize: 11.5, color: "var(--color-neutral-500)" }}>…</div>}
        </div>
        <div style={{ borderTop: "2px solid var(--color-neutral-700)", padding: "12px 20px", display: "flex", gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            disabled={!chat}
            placeholder={chat ? "Type as the customer…" : "Start a chat first"}
            aria-label="Message"
            style={{ ...INPUT, flex: 1, fontSize: 13.5, padding: "10px 12px" }}
          />
          <button
            type="button"
            className="hov-accent-dark"
            disabled={!chat || pending || !draft.trim()}
            onClick={send}
            style={{ fontSize: 12.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "0 18px" }}
          >
            Send
          </button>
        </div>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div style={LABEL}>Business</div>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} disabled={Boolean(chat)} aria-label="Business" style={INPUT}>
            {businesses.map((b) => (
              <option key={b.brandId} value={b.brandId} style={{ color: "var(--color-text)" }}>
                {b.business}
                {b.agentName ? ` · ${b.agentName}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={LABEL}>You are</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} disabled={Boolean(chat)} aria-label="Your number" style={{ ...INPUT, flex: 1 }} />
            <button
              type="button"
              disabled={Boolean(chat)}
              onClick={() => setCallerPhone(freshMobile())}
              className="hov-invert-dark"
              style={{ fontSize: 11, border: "1px solid var(--color-neutral-600)", padding: "0 9px" }}
            >
              New
            </button>
          </div>
          {known.length > 0 && (
            <select
              value={known.find((k) => k.phone === callerPhone)?.phone ?? ""}
              onChange={(e) => e.target.value && setCallerPhone(e.target.value)}
              disabled={Boolean(chat)}
              aria-label="Chat as a known customer"
              style={{ ...INPUT, marginTop: 6, fontSize: 12 }}
            >
              <option value="" style={{ color: "var(--color-text)" }}>
                …or chat as a customer they know
              </option>
              {known.map((c) => (
                <option key={c.phone} value={c.phone} style={{ color: "var(--color-text)" }}>
                  {c.name}
                  {c.detail ? ` · ${c.detail}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, opacity: chat ? 0.6 : 1 }}>
          <input type="checkbox" checked={counts} disabled={Boolean(chat)} onChange={(e) => setCounts(e.target.checked)} style={{ accentColor: "var(--color-accent)", marginTop: 2 }} />
          <span>Count this chat in the business&rsquo;s numbers</span>
        </label>

        {!chat ? (
          <button
            type="button"
            className="hov-accent-dark"
            disabled={pending || !business}
            onClick={begin}
            style={{ fontSize: 12.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "12px 16px" }}
          >
            {pending ? "Starting…" : "Start chatting"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="hov-invert-dark"
              onClick={end}
              style={{ fontSize: 12.5, fontWeight: 700, border: "2px solid var(--color-bg)", padding: "11px 16px" }}
            >
              End the chat
            </button>
            <a
              href={`/app/live?call=${chat.id}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-accent-400)" }}
            >
              Watch this chat on Live →
            </a>
          </>
        )}

        {error && (
          <div role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-400)", lineHeight: 1.45, border: "1px solid var(--color-accent-800)", padding: "9px 11px" }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
