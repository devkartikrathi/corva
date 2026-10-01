import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { APP_URL } from "@/lib/email";
import { ENDPOINTS, type Endpoint } from "@/lib/integrations/openapi";

export const metadata = {
  title: "Corva for developers",
  description: "Connect a business's website to its Corva AI assistant: chat, leads, visitors and voice.",
};

/**
 * The developer documentation.
 *
 * Written for the developer a business hands its Corva key to — somebody who
 * has never heard of us and wants the chat working on their site this
 * afternoon. The reference is generated from the same list the OpenAPI spec
 * is, so the page and the spec say the same thing.
 */

const SHELL: CSSProperties = { maxWidth: 980, margin: "0 auto", padding: "0 28px" };
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

function Code({ children }: { children: string }) {
  return (
    <pre
      style={{
        margin: "12px 0 0",
        padding: "14px 16px",
        background: "var(--color-text)",
        color: "var(--color-bg)",
        fontFamily: MONO,
        fontSize: 12.5,
        lineHeight: 1.6,
        overflowX: "auto",
        whiteSpace: "pre",
      }}
    >
      {children}
    </pre>
  );
}

const C = ({ children }: { children: ReactNode }) => (
  <code style={{ fontFamily: MONO, fontSize: "0.9em", background: "var(--color-surface)", padding: "1px 5px" }}>{children}</code>
);

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} style={{ margin: "48px 0 0", fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", scrollMarginTop: 20 }}>
      {children}
    </h2>
  );
}

const P = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.65, color: "var(--color-neutral-800)" }}>{children}</p>
);

function curlFor(e: Endpoint) {
  if (e.method === "GET") {
    const q = e.query ? `?${Object.keys(e.query).map((k) => `${k}=…`).join("&")}` : "";
    return `curl ${APP_URL}${e.path}${q} \\\n  -H "Authorization: Bearer $CORVA_API_KEY"`;
  }
  return `curl -X POST ${APP_URL}${e.path} \\\n  -H "Authorization: Bearer $CORVA_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(e.example ?? {}, null, 2)}'`;
}

function EndpointBlock({ e }: { e: Endpoint }) {
  const fields = e.request ?? e.query;
  return (
    <section id={`${e.method}-${e.path}`} style={{ marginTop: 34, paddingTop: 22, borderTop: "2px solid var(--color-divider)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 12,
            fontWeight: 700,
            padding: "3px 8px",
            background: e.method === "GET" ? "var(--color-neutral-200)" : "var(--color-accent)",
            color: e.method === "GET" ? "var(--color-text)" : "var(--color-bg)",
          }}
        >
          {e.method}
        </span>
        <code style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700 }}>{e.path}</code>
        <span style={{ fontSize: 14, color: "var(--color-neutral-700)" }}>— {e.summary}</span>
      </div>
      <P>{e.description}</P>
      {fields && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 13.5 }}>
          <tbody>
            {Object.entries(fields).map(([name, f]) => (
              <tr key={name} style={{ borderBottom: "1px solid var(--color-neutral-300)", verticalAlign: "top" }}>
                <td style={{ padding: "8px 12px 8px 0", width: 170 }}>
                  <code style={{ fontFamily: MONO, fontWeight: 700 }}>{name}</code>
                  {f.required && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--color-accent-700)", fontWeight: 700 }}>required</span>}
                </td>
                <td style={{ padding: "8px 12px 8px 0", width: 170, fontFamily: MONO, fontSize: 12, color: "var(--color-neutral-700)" }}>{f.type}</td>
                <td style={{ padding: "8px 0", color: "var(--color-neutral-800)", lineHeight: 1.5 }}>{f.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Code>{curlFor(e)}</Code>
      <Code>{JSON.stringify(e.response, null, 2)}</Code>
    </section>
  );
}

export default function DevelopersPage() {
  return (
    <main style={{ background: "var(--color-bg)", minHeight: "100vh", paddingBottom: 80 }}>
      <header style={{ borderBottom: "2px solid var(--color-divider)" }}>
        <div style={{ ...SHELL, height: 64, display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/" style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em", color: "var(--color-text)" }}>
            CORVA
          </Link>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-neutral-700)" }}>
            Developers
          </span>
          <a href="/api/v1/openapi.json" style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
            OpenAPI spec →
          </a>
        </div>
      </header>

      <div style={SHELL}>
        <h1 style={{ margin: "44px 0 0", fontWeight: 800, fontSize: 44, lineHeight: 1.02, letterSpacing: "-0.03em", maxWidth: "18ch" }}>
          Put a business&rsquo;s AI assistant on its website.
        </h1>
        <P>
          Corva runs an AI assistant for each business: it answers from the business&rsquo;s own knowledge, stays within
          the limits the business sets, and turns every conversation into records the team works from — a customer, a
          lead with an owner, a follow-up with a time. This API is how a website plugs into it.
        </P>

        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {[
            {
              title: "Through the API",
              body: "Your site talks to Corva from its server: chat with the assistant, send bookings and callback requests, record visitors, start voice calls in the browser. This page is for you.",
            },
            {
              title: "Through a phone number",
              body: "No code at all. The business gets a number from Corva; whoever rings it talks to the same assistant, with the same knowledge, and lands in the same console.",
            },
          ].map((c) => (
            <div key={c.title} style={{ border: "2px solid var(--color-text)", padding: "16px 18px" }}>
              <b style={{ fontSize: 16 }}>{c.title}</b>
              <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.55, color: "var(--color-neutral-800)" }}>{c.body}</p>
            </div>
          ))}
        </div>

        <nav style={{ marginTop: 28, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13.5, fontWeight: 600 }}>
          {[
            ["#start", "Quick start"],
            ["#auth", "Keys & errors"],
            ["#reference", "Reference"],
            ["#voice", "Voice in the browser"],
            ["#cookies", "Cookies & consent"],
          ].map(([href, label]) => (
            <a key={href} href={href} style={{ color: "var(--color-accent-700)" }}>
              {label}
            </a>
          ))}
        </nav>

        <H2 id="start">Quick start</H2>
        <ol style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: 15, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>
          <li>
            The business makes a key in Corva → <b>Settings → Website &amp; API keys</b> and gives it to you. It starts with{" "}
            <C>ck_</C> and is shown once.
          </li>
          <li>
            Put it in your server&rsquo;s environment — <C>CORVA_API_KEY</C> — next to <C>CORVA_API_URL={APP_URL}</C>.
            Never ship it to the browser.
          </li>
          <li>
            Check it: <C>GET /api/v1/health</C> returns the business, its assistant and which features you can use.
          </li>
          <li>
            Pick your shape:
            <ul style={{ paddingLeft: 18 }}>
              <li>
                <b>Corva&rsquo;s assistant</b> (how Tumble Days&rsquo; Tumbly works) — send each customer message to{" "}
                <C>POST /api/v1/chat</C> and show the reply, streamed if you like. When the assistant has a booking or
                callback ready it returns a <C>proposal</C>: show it as a card, and send the customer&rsquo;s Confirm or
                Edit to <C>POST /api/v1/chat/confirm</C>. Knowledge, bookings, the team&rsquo;s follow-ups and emails
                all happen in Corva.
              </li>
              <li>
                <b>Your own assistant</b> — keep it, and send Corva what matters: bookings and callbacks to{" "}
                <C>POST /api/v1/leads</C>, the transcript to <C>POST /api/v1/chats</C>.
              </li>
            </ul>
          </li>
          <li>
            Optional: record visitors with their cookie consent (<C>/visits</C>) and add a &ldquo;talk to us&rdquo; voice
            button (<C>/voice-sessions</C>).
          </li>
        </ol>
        <Code>{`// A tiny server-side client — Node / Next.js route handler.
export async function corva(path: string, body?: unknown) {
  const res = await fetch(\`\${process.env.CORVA_API_URL}/api/v1/\${path}\`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: \`Bearer \${process.env.CORVA_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

const { reply } = await corva("chat", { sessionId: "chat_8c1f2a", message: "Do you pick up from Sector 56?" });`}</Code>

        <H2 id="auth">Keys, errors and limits</H2>
        <P>
          Every request carries <C>Authorization: Bearer ck_…</C>. A key belongs to one business; revoking it in Settings
          stops it at once. Requests and responses are JSON.
        </P>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 14 }}>
          <tbody>
            {[
              ["200", "Done. The body is the result."],
              ["400", "Something in the request is wrong. `error` says what, in words you can show a user."],
              ["401", "The key is missing, wrong, or revoked."],
              ["409", "The chat has ended (start a new sessionId), or a card was answered or replaced already."],
              ["422", "A card can no longer be confirmed as it is — e.g. its date has passed. Show `error` and let them edit."],
              ["413", "The body is over 64 KB."],
              ["429", "Over 120 requests a minute for this key. Back off and retry."],
              ["5xx", "Our side. Retry; /leads is safe to retry with the same reference."],
            ].map(([code, text]) => (
              <tr key={code} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                <td style={{ padding: "8px 12px 8px 0", width: 70, fontFamily: MONO, fontWeight: 700 }}>{code}</td>
                <td style={{ padding: "8px 0", color: "var(--color-neutral-800)" }}>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <H2 id="reference">Reference</H2>
        <P>
          Base URL <C>{APP_URL}</C>. The same endpoints as a spec:{" "}
          <a href="/api/v1/openapi.json" style={{ color: "var(--color-accent-700)" }}>
            /api/v1/openapi.json
          </a>
          .
        </P>
        {ENDPOINTS.map((e) => (
          <EndpointBlock key={`${e.method} ${e.path}`} e={e} />
        ))}

        <H2 id="voice">Voice calls in the browser</H2>
        <P>
          Your server gets a token from <C>POST /api/v1/voice-sessions</C> and gives the page <C>token</C> and{" "}
          <C>bridgeUrl</C>. The page opens a WebSocket to the bridge and speaks. The conversation, and anything the
          assistant records during it, lands in the business&rsquo;s console like a phone call.
        </P>
        <Code>{`→ connect   new WebSocket(bridgeUrl)
→ send      {"type":"start","token":"…"}
← receive   {"type":"ready", "agent":"Tumbly", ...}

  while the user holds "talk":
→ send      binary frames — PCM16, mono, 16 kHz
  when they let go:
→ send      {"type":"end_turn"}

← receive   binary frames — PCM16, mono, 24 kHz: the assistant's voice
← receive   {"type":"heard","text":"…"}    what the user said, so far
← receive   {"type":"said","text":"…"}     what the assistant said, so far
← receive   {"type":"turn_complete"}
← receive   {"type":"held","by":"Kavya Rao"}   a person took over; stop playback
            the assistant says one line handing over, then their voice
            arrives as the same 24 kHz binary frames — keep playing them
← receive   {"type":"human","name":"…","text":"…"}  what they said or typed
← receive   {"type":"released"}              handed back to the assistant
← receive   {"type":"closed","reason":"…"}  /  {"type":"error","message":"…"}
→ send      {"type":"stop"}                  hang up`}</Code>
        <P>
          <b>Browsers, and iPhones in particular.</b> The microphone only works on an <b>https</b> page (or{" "}
          <C>localhost</C>) — on plain http, Safari never asks for permission and <C>navigator.mediaDevices</C> is
          missing. Ask for the microphone and create your <C>AudioContext</C> in the tap handler itself, before any{" "}
          <C>await</C>, or iOS will neither prompt nor play sound. Use the device&rsquo;s own sample rate and resample to
          16 kHz yourself; iOS does not honour a requested rate. And the bridge must be <b>wss://</b> for an https page —
          <C>/health</C> tells you (<C>features.voiceSecure</C>).
        </P>

        <H2 id="cookies">Cookies &amp; consent</H2>
        <P>
          Corva does not set cookies on your site. We suggest two first-party cookies, both strictly necessary: a random
          visitor id (so a chat, a request and a call from one browser join up — send it as <C>visitorId</C>), and the
          visitor&rsquo;s choice on your cookie banner. Send that choice as <C>consent</C> on every <C>/visits</C> call:
          with <C>&quot;necessary&quot;</C> Corva keeps only the id; with <C>&quot;all&quot;</C> it also keeps pages,
          referrer and campaign, and shows them on the customer&rsquo;s record once they tell you who they are. Changing
          to <C>&quot;necessary&quot;</C> later forgets what was kept.
        </P>

        <p style={{ marginTop: 56, fontSize: 13, color: "var(--color-neutral-700)" }}>
          Corva API {"v1"} · questions: ask whoever at the business gave you the key, or Corva support.
        </p>
      </div>
    </main>
  );
}
