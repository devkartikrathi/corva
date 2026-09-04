"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Open a new conversation with this customer.
 *
 * Picks a channel first, because the channel changes what the agent is allowed
 * to do — an email draft and a live phone call are not the same commitment —
 * and then goes straight to the console rather than leaving you to find the
 * conversation you just started.
 */
const CHANNELS = [
  { value: "phone", label: "Phone" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "web_chat", label: "Web chat" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
] as const;

export function StartConversation({
  customerId,
  customerName,
  onStart,
}: {
  customerId: string;
  customerName: string;
  onStart: (
    customerId: string,
    channel: "phone" | "whatsapp" | "web_chat" | "email" | "sms",
  ) => Promise<string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="hov-accent"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        aria-expanded={open}
        style={{
          fontSize: 12,
          fontWeight: 700,
          background: "var(--color-accent)",
          color: "var(--color-bg)",
          padding: "10px 14px",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "Opening…" : "Open a conversation"}
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label={`Channel to reach ${customerName} on`}
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 30,
            minWidth: 160,
            padding: 0,
            listStyle: "none",
            background: "var(--color-bg)",
            border: "2px solid var(--color-text)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {CHANNELS.map((c) => (
            <li key={c.value}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="hov-raise"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                  startTransition(async () => {
                    try {
                      const id = await onStart(customerId, c.value);
                      router.push(`/app/live?call=${id}`);
                    } catch (e) {
                      setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
                    }
                  });
                }}
                style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 12.5 }}
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <span
          role="alert"
          style={{ position: "absolute", top: "100%", left: 0, fontSize: 10.5, color: "var(--color-accent-700)" }}
        >
          {error}
        </span>
      )}
    </span>
  );
}
