"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Open a conversation with this customer — only on a channel that reaches
 * them: a phone call (logged: Corva has no outbound line yet), WhatsApp, or
 * email. Web chat cannot be started from here, and SMS is never a
 * conversation. Each option says why when it is not possible.
 */
type WhatsAppOpening = { possible: true; via: "message" } | { possible: true; via: "template"; template: string } | { possible: false; reason: string };

const input = { width: "100%", border: "1px solid var(--color-neutral-400)", background: "var(--color-surface)", padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", borderRadius: 0 } as const;
const primary = { fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "7px 12px", cursor: "pointer" } as const;
const errorText = (e: unknown) => (e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.");

export function StartConversation({
  customerId,
  customerName,
  phone,
  email,
  whatsapp,
  onCall,
  onWhatsApp,
  onEmail,
}: {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  whatsapp: WhatsAppOpening;
  onCall: (customerId: string, notes: string) => Promise<string>;
  onWhatsApp: (customerId: string, message: string) => Promise<string>;
  onEmail: (customerId: string, subject: string, body: string) => Promise<string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<"phone" | "whatsapp" | "email" | null>(null);
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const go = (fn: () => Promise<string>, to: (id: string) => string) =>
    start(async () => {
      setError(null);
      try {
        const id = await fn();
        setOpen(false);
        router.push(to(id) as never);
      } catch (e) {
        setError(errorText(e));
      }
    });

  const options = [
    { key: "phone" as const, label: "Phone", note: phone ? `Ring ${phone}, then log the call` : "No phone number on file", ok: Boolean(phone) },
    {
      key: "whatsapp" as const,
      label: "WhatsApp",
      note: whatsapp.possible ? (whatsapp.via === "message" ? "They wrote in the last 24 hours" : `Sends your template “${whatsapp.template}”`) : whatsapp.reason,
      ok: whatsapp.possible,
    },
    { key: "email" as const, label: "Email", note: email ? `To ${email}` : "No email address on file", ok: Boolean(email) },
  ];

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="hov-accent"
        onClick={() => {
          setOpen((v) => !v);
          setChannel(null);
          setError(null);
        }}
        aria-expanded={open}
        style={{ fontSize: 12, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "10px 14px" }}
      >
        Open a conversation
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Reach ${customerName}`}
          style={{
            position: "absolute",
            insetInlineEnd: 0,
            top: "100%",
            marginTop: 4,
            zIndex: 30,
            width: 340,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--color-bg)",
            border: "2px solid var(--color-text)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            fontSize: 12.5,
          }}
        >
          {!channel &&
            options.map((o) => (
              <button
                key={o.key}
                type="button"
                disabled={!o.ok}
                className={o.ok ? "hov-raise" : undefined}
                onClick={() => setChannel(o.key)}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", borderBottom: "1px solid var(--color-neutral-300)", cursor: o.ok ? "pointer" : "not-allowed", opacity: o.ok ? 1 : 0.55 }}
              >
                <b>{o.label}</b>
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)", marginTop: 2, lineHeight: 1.4 }}>{o.note}</span>
              </button>
            ))}

          {channel && (
            <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <button type="button" onClick={() => setChannel(null)} style={{ alignSelf: "flex-start", fontSize: 11, color: "var(--color-neutral-700)" }}>
                ← Channels
              </button>

              {channel === "phone" && phone && (
                <>
                  <a href={`tel:${phone.replace(/\s/g, "")}`} style={{ fontWeight: 800, fontSize: 15, color: "var(--color-text)" }}>
                    {phone}
                  </a>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>Ring them from your phone, then note what was said so it is on their record.</span>
                  <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="What was said, what was agreed" aria-label="Call notes" style={input} />
                  <button type="button" disabled={pending || !notes.trim()} style={primary} onClick={() => go(() => onCall(customerId, notes), (id) => `/app/conversations/${id}`)}>
                    {pending ? "Saving…" : "Log the call"}
                  </button>
                </>
              )}

              {channel === "whatsapp" && whatsapp.possible && (
                <>
                  {whatsapp.via === "message" ? (
                    <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} placeholder={`Your message to ${customerName}`} aria-label="WhatsApp message" style={input} />
                  ) : (
                    <span style={{ fontSize: 11.5, lineHeight: 1.45 }}>
                      They have not written in the last 24 hours, so WhatsApp only allows your approved template “{whatsapp.template}”. When they reply, the chat opens for you here.
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={pending || (whatsapp.via === "message" && !message.trim())}
                    style={primary}
                    onClick={() => go(() => onWhatsApp(customerId, message), (id) => `/app/live?call=${id}`)}
                  >
                    {pending ? "Sending…" : whatsapp.via === "message" ? "Send on WhatsApp" : "Send the template"}
                  </button>
                </>
              )}

              {channel === "email" && email && (
                <>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>To {email}, from your business. Their reply comes back to this customer&rsquo;s record.</span>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" style={input} />
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Your email" aria-label="Email" style={input} />
                  <button type="button" disabled={pending || !subject.trim() || !body.trim()} style={primary} onClick={() => go(() => onEmail(customerId, subject, body), (id) => `/app/conversations/${id}`)}>
                    {pending ? "Sending…" : "Send email"}
                  </button>
                </>
              )}

              {error && (
                <span role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
                  {error}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
