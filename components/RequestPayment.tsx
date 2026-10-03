"use client";

import { useState, useTransition } from "react";

type Made = { reference: string; amountRupees: number; url: string | null; qrUrl: string | null; status: string };

/**
 * Ask the customer in this conversation to pay. An amount, or an order
 * reference for the business to work out what is owed; the link comes back
 * from the business's own system, and can be posted straight to the customer.
 */
export function RequestPayment({
  conversationId,
  canSend,
  onRequest,
}: {
  conversationId: string;
  /** Whether a link posted here reaches the customer (WhatsApp) or only the transcript. */
  canSend: boolean;
  onRequest: (
    conversationId: string,
    input: { amountRupees?: string; orderReference?: string; description?: string; send: boolean },
  ) => Promise<Made>;
}) {
  const [amount, setAmount] = useState("");
  const [order, setOrder] = useState("");
  const [description, setDescription] = useState("");
  const [send, setSend] = useState(canSend);
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const input = { border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0, minWidth: 0 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
      <div className="m-stack" style={{ display: "grid", gridTemplateColumns: "110px 130px 1fr", gap: 6 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="₹ amount" inputMode="decimal" aria-label="Amount in rupees" style={input} />
        <input value={order} onChange={(e) => setOrder(e.target.value)} placeholder="or order ref" aria-label="Order reference" style={input} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="For (optional)" aria-label="What it is for" style={input} />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} />
          {canSend ? "Send it to the customer here" : "Post it in the transcript"}
        </label>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="hov-accent"
          disabled={pending || (!amount.trim() && !order.trim())}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                setMade(await onRequest(conversationId, { amountRupees: amount, orderReference: order, description, send }));
                setAmount("");
                setOrder("");
                setDescription("");
              } catch (e) {
                setError(e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "The link could not be made.");
              }
            });
          }}
          style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px", opacity: pending ? 0.6 : 1 }}
        >
          {pending ? "Asking…" : "Request payment"}
        </button>
      </div>
      {error && (
        <span role="alert" style={{ color: "var(--color-accent-700)" }}>
          {error}
        </span>
      )}
      {made?.url && (
        <div style={{ border: "1px solid var(--color-neutral-400)", padding: "8px 10px", background: "var(--color-surface)" }}>
          <b>
            ₹{made.amountRupees.toLocaleString("en-IN")} · {made.reference}
          </b>{" "}
          — <a href={made.url} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent-700)", fontWeight: 700, wordBreak: "break-all" }}>{made.url}</a>
          {made.qrUrl && (
            <>
              {" · "}
              <a href={made.qrUrl} target="_blank" rel="noreferrer" style={{ color: "var(--color-accent-700)", fontWeight: 700 }}>
                QR
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
