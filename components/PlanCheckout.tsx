"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Buying a plan with Razorpay Checkout — the same two steps as in myfin.
 *
 * 1. The server opens an order for the plan (it decides the amount).
 * 2. Razorpay's checkout takes the payment and hands back a signature, which
 *    the server verifies before the plan changes.
 *
 * If the tab closes between the two, Razorpay's webhook still grants the plan.
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

type Handler = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type Options = {
  key: string;
  amount: number;
  currency: string;
  order_id: string;
  name: string;
  description: string;
  handler: (response: Handler) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
  prefill?: { name?: string; email?: string };
};
type Instance = { open: () => void; on: (event: "payment.failed", handler: (f: { error?: { description?: string } }) => void) => void };

declare global {
  interface Window {
    Razorpay?: new (options: Options) => Instance;
  }
}

let script: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  script ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error("Could not reach Razorpay — check the connection and try again."));
    document.body.appendChild(el);
  }).catch((e) => {
    script = null;
    throw e;
  });
  return script;
}

type Status = "idle" | "preparing" | "open" | "verifying" | "paid" | "error";

export function PlanCheckout({ tier, label, featured }: { tier: string; label: string; featured?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const start = async () => {
    setStatus("preparing");
    setMessage(null);
    try {
      const [res] = await Promise.all([
        fetch("/api/razorpay/order", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier }) }),
        loadCheckout(),
      ]);
      const order = (await res.json().catch(() => ({}))) as {
        error?: string;
        keyId: string;
        orderId: string;
        amount: number;
        currency: string;
        description: string;
        prefill?: { name?: string; email?: string };
      };
      if (!res.ok) throw new Error(order.error ?? "Could not start the payment.");
      if (!window.Razorpay) throw new Error("Razorpay's checkout did not load.");

      setStatus("open");
      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "Corva",
        description: order.description,
        theme: { color: "#2D2B2B" },
        prefill: order.prefill,
        modal: { ondismiss: () => setStatus((s) => (s === "open" ? "idle" : s)) },
        handler: (response) => {
          void (async () => {
            setStatus("verifying");
            const check = await fetch("/api/razorpay/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(response),
            });
            const result = (await check.json().catch(() => ({}))) as { verified?: boolean; pending?: boolean; error?: string };
            if (!check.ok || !result.verified) {
              setStatus("error");
              setMessage(result.error ?? "We could not confirm that payment. If money left your account, it will be reconciled — tell Corva.");
              return;
            }
            setStatus("paid");
            setMessage(result.pending ? "Paid. Your plan will update in a moment." : "Paid — your plan is active.");
            router.refresh();
          })();
        },
      });
      checkout.on("payment.failed", (f) => {
        setStatus("error");
        setMessage(f.error?.description ?? "The payment did not go through.");
      });
      checkout.open();
    } catch (e) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Could not start the payment.");
    }
  };

  const busy = status === "preparing" || status === "open" || status === "verifying";
  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={busy || status === "paid"}
        className={featured ? "hov-accent" : "hov-invert"}
        style={{
          width: "100%",
          fontSize: 13,
          fontWeight: 700,
          padding: "12px 16px",
          cursor: busy ? "progress" : "pointer",
          opacity: busy ? 0.7 : 1,
          ...(featured
            ? { background: "var(--color-accent)", color: "var(--color-bg)" }
            : { border: "2px solid var(--color-text)", color: "var(--color-text)" }),
        }}
      >
        {status === "preparing" ? "Preparing…" : status === "open" ? "Waiting for payment…" : status === "verifying" ? "Confirming…" : status === "paid" ? "Paid" : label}
      </button>
      {message && (
        <p role={status === "error" ? "alert" : "status"} style={{ margin: "8px 0 0", fontSize: 12, color: status === "error" ? "var(--color-accent-700)" : "var(--color-neutral-800)" }}>
          {message}
        </p>
      )}
    </div>
  );
}
