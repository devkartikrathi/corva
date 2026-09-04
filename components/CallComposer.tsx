"use client";

import { useRef, useState, useTransition } from "react";

/**
 * The bar at the foot of the live transcript.
 *
 * Two modes, and which one you get is decided by the server, not by a toggle
 * here: while the AI holds the line you can only put a customer message in
 * front of it, and once you have taken the line you can only speak yourself.
 * That mirrors what is actually true of the conversation — two parties cannot
 * both be answering — and it means the screen can never offer an action the
 * server would refuse.
 */
export function CallComposer({
  conversationId,
  aiHolding,
  heldByYou,
  ended,
  onCustomerMessage,
  onHumanReply,
}: {
  conversationId: string;
  aiHolding: boolean;
  heldByYou: boolean;
  ended: boolean;
  onCustomerMessage: (conversationId: string, body: string) => Promise<unknown>;
  onHumanReply: (conversationId: string, body: string) => Promise<unknown>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const disabled = ended || (!aiHolding && !heldByYou);

  const send = () => {
    const body = value.trim();
    if (!body || pending || disabled) return;
    setError(null);
    startTransition(async () => {
      try {
        await (aiHolding ? onCustomerMessage(conversationId, body) : onHumanReply(conversationId, body));
        setValue("");
        inputRef.current?.focus();
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Something went wrong.");
      }
    });
  };

  const label = ended
    ? "This conversation has ended"
    : aiHolding
      ? "As the customer"
      : heldByYou
        ? "As you"
        : "Someone else holds this";

  const placeholder = ended
    ? "Closed — reopen it from the archive to add anything."
    : aiHolding
      ? "Type what the customer says. The agent retrieves, checks its authority, and answers for real."
      : heldByYou
        ? "Type your reply to the customer…"
        : "Take the line before you can reply.";

  return (
    <div style={{ borderTop: "2px solid var(--color-divider)", padding: "12px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: aiHolding ? "var(--color-neutral-700)" : "var(--color-accent-700)",
            paddingTop: 10,
            width: 116,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
        <textarea
          ref={inputRef}
          rows={2}
          value={value}
          disabled={disabled || pending}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line. A transcript turn is
            // usually one sentence, so sending is the common case.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{
            flex: 1,
            border: "1px solid var(--color-neutral-400)",
            background: disabled ? "var(--color-neutral-200)" : "var(--color-surface)",
            padding: "9px 11px",
            fontSize: 12.5,
            fontFamily: "inherit",
            lineHeight: 1.45,
            color: "var(--color-text)",
            borderRadius: 0,
            resize: "vertical",
            outline: "none",
          }}
        />
        <button
          type="button"
          className="hov-accent"
          onClick={send}
          disabled={disabled || pending || !value.trim()}
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            background: disabled || !value.trim() ? "var(--color-neutral-400)" : "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "10px 15px",
            marginTop: 1,
            cursor: pending ? "progress" : disabled ? "not-allowed" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {pending ? (aiHolding ? "Thinking…" : "Sending…") : "Send"}
        </button>
      </div>
      {error && (
        <p role="alert" style={{ margin: "8px 0 0 126px", fontSize: 11.5, color: "var(--color-accent-700)" }}>
          {error}
        </p>
      )}
      {!error && aiHolding && !ended && (
        <p style={{ margin: "8px 0 0 126px", fontSize: 11, color: "var(--color-neutral-700)" }}>
          The reply comes from the live agent version, grounded in this brand&rsquo;s documents. If it
          hits a ceiling or a trigger it will stop and write a brief, exactly as it would on the phone.
        </p>
      )}
    </div>
  );
}
