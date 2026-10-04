import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { APP_URL } from "@/lib/email";
import { ENDPOINTS, WEBHOOK_EXAMPLES, type Endpoint } from "@/lib/integrations/openapi";
import { WEBHOOK_EVENTS } from "@/lib/integrations/webhooks";

export const metadata = {
  title: "Corva for developers",
  description: "Connect a business's website and systems to its Corva AI assistant: chat, bookings and leads, customers, order records, payments, visitors, voice, and webhooks.",
};

/**
 * The developer documentation.
 *
 * Written for the developer a business hands its Corva key to — somebody who
 * has never heard of us and wants the chat working on their site this
 * afternoon. Nothing here is about one business: what a business collects,
 * books and calls its assistant comes from its own setup (GET /config). The
 * reference is generated from the same list the OpenAPI spec is, so the page
 * and the spec say the same thing.
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
    // Two or three of the filters, as an example — not all of them at once.
    const q = e.query ? `?${Object.keys(e.query).slice(0, 3).map((k) => `${k.replace("<key>", "service_type")}=…`).join("&")}` : "";
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
        <div className="m-scroll">
        <table className="cv-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 13.5 }}>
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
        </div>
      )}
      <Code>{curlFor(e)}</Code>
      <Code>{JSON.stringify(e.response, null, 2)}</Code>
    </section>
  );
}

const GROUPS: { name: Endpoint["group"]; blurb: string }[] = [
  { name: "Setup", blurb: "Check the key, and read how the business is set up." },
  { name: "Chat", blurb: "The assistant in your chat window — or your own assistant's transcripts." },
  { name: "Leads", blurb: "Bookings, callbacks and enquiries from your own forms." },
  { name: "Records", blurb: "Read the business's leads, customers and conversations back; keep a lead in step with your system; tell the assistant where an order has got to." },
  { name: "Payments", blurb: "Tell Corva where a payment to the business stands, so the team and the assistant know it was paid." },
  { name: "Visitors", blurb: "Who is on the site, with their consent." },
  { name: "Voice", blurb: "Talk to the assistant from the browser." },
];

const H3 = ({ children }: { children: ReactNode }) => (
  <h3 style={{ margin: "26px 0 0", fontWeight: 800, fontSize: 17 }}>{children}</h3>
);

export default function DevelopersPage() {
  return (
    <main className="dev" style={{ background: "var(--color-bg)", minHeight: "100vh", paddingBottom: 80 }}>
      <header style={{ borderBottom: "2px solid var(--color-divider)" }}>
        <div className="lp-shell m-gap" style={{ ...SHELL, height: 64, display: "flex", alignItems: "center", gap: 18 }}>
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

      <div className="lp-shell" style={SHELL}>
        <h1 style={{ margin: "44px 0 0", fontWeight: 800, fontSize: 44, lineHeight: 1.02, letterSpacing: "-0.03em", maxWidth: "20ch" }}>
          Put a business&rsquo;s AI assistant on its website — and its work in your systems.
        </h1>
        <P>
          Corva runs an AI assistant for each business. It answers from the business&rsquo;s own knowledge, stays within
          the limits the business sets, collects the details the business asks for, and turns every conversation into
          records the team works from: a customer, a lead with an owner, a follow-up with a time. A person on the team
          can take any chat or call over, live. This API is how a website and the business&rsquo;s other systems plug
          into that.
        </P>

        <div className="m-stack" style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {[
            {
              title: "Corva’s assistant on your site",
              body: "Your chat window, Corva’s brain. Send each message to /chat, show the reply, show a card when a booking is ready. Most sites start here.",
            },
            {
              title: "Your own assistant, Corva behind it",
              body: "Keep the bot or the forms you have. Send bookings and callbacks to /leads and transcripts to /chats; Corva gives them owners, follow-ups and emails.",
            },
            {
              title: "Voice on your site",
              body: "A call button: your server fetches a short-lived token, the page talks to the assistant over a WebSocket, and the business’s team can take the call over and speak.",
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
            ["#concepts", "How it fits together"],
            ["#auth", "Keys, errors & limits"],
            ["#reference", "API reference"],
            ["#voice", "Voice in the browser"],
            ["#webhooks", "Webhooks"],
            ["#payments", "Taking payments"],
            ["#cookies", "Cookies & consent"],
            ["#golive", "Going live"],
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
            These are the only two settings an integration needs. Never ship the key to the browser.
          </li>
          <li>
            Check it: <C>GET /api/v1/health</C>. Then read <C>GET /api/v1/config</C> for the assistant&rsquo;s name, what
            can be booked and the details the business collects.
          </li>
          <li>
            Add a route on your server that forwards the visitor&rsquo;s message to <C>POST /api/v1/chat</C> and returns the
            reply. When the reply carries a <C>proposal</C>, show it as a card; send Confirm or Edit to{" "}
            <C>POST /api/v1/chat/confirm</C>. When the customer closes the chat or reloads the page, send{" "}
            <C>POST /api/v1/chat/end</C>.
          </li>
          <li>
            Optional: voice calls (<C>/voice-sessions</C>), visitor tracking with consent (<C>/visits</C>), order status
            for the assistant to answer from (<C>/records</C>), payments (<C>/payments</C>), and a webhook so your own
            systems hear about new leads.
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
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

const { assistant, fields, booking } = await corva("config");

const turn = await corva("chat", { sessionId, message, visitorId });
// turn.reply     → show it
// turn.proposal  → show a card; on Confirm:
await corva("chat/confirm", { sessionId, proposalId: turn.proposal.id, approved: true });

// The window closed, or the page is unloading (sendBeacon to your own route):
await corva("chat/end", { sessionId });`}</Code>

        <H2 id="concepts">How it fits together</H2>
        <H3>Sessions and visitors</H3>
        <P>
          A <C>sessionId</C> is one chat — you make it up, reuse it for every message, and start a new one for a new
          chat. A <C>visitorId</C> is one browser, kept in a first-party cookie you set. Send it on everything and Corva
          joins a visitor&rsquo;s page views, chats, bookings and voice calls into one customer record once they say who
          they are.
        </P>
        <H3>When a chat ends</H3>
        <P>
          A call hangs up; a chat window just closes. Send <C>POST /api/v1/chat/end</C> when it does — from a{" "}
          <C>pagehide</C> handler, with <C>navigator.sendBeacon</C> to your own server route — and the conversation is
          closed, summarised and sent to your <C>conversation.ended</C> webhook at once. If you do not, Corva ends it when
          the same <C>visitorId</C> starts a new <C>sessionId</C>, or after 30 quiet minutes. Either way that{" "}
          <C>sessionId</C> is finished: the next message answers <C>409</C>, so start a new one.
        </P>
        <H3>One customer, every channel — and who is proven</H3>
        <P>
          Corva keeps one customer record across website chat, voice, phone, WhatsApp, email and what your system sends.
          Every number and email they have used is on it, each marked <b>verified</b> (they wrote from it on WhatsApp or
          email, they called from it, your system sent it, or they entered a code sent to it) or <b>stated</b> (typed into
          a chat). A browser that was identified before starts its next chat as that customer.
        </P>
        <P>
          What you pass as <C>customer</C> on <C>/chat</C> is <b>stated</b>: the chat joins that record, but the
          assistant reads out what is on file (an address, past payments) and asks for a payment only once the customer
          proves who they are — it sends a six-digit code by SMS or email to the number or email <i>already on file</i>,
          never to one typed in the chat, and the model never sees the code. Records you send to <C>/records</C> and{" "}
          <C>/payments</C> count as verified. Two customers are never merged on a claim; a likely match goes to the team.
        </P>
        <H3>The leads board</H3>
        <P>
          Five stages, the same for every business: <C>new</C> (New), <C>contacted</C> (Contacted), <C>proposal</C>{" "}
          (Processing), <C>won</C> (Converted), <C>lost</C> (Lost). A customer saying who they are makes a New lead; a
          confirmed booking makes it Contacted; a payment reported <C>paid</C> makes it Converted. Move it to Processing
          and Converted from your own system with <C>POST /api/v1/leads/{"{id}"}</C>; Lost is only ever a person&rsquo;s
          call. Older leads may say <C>qualified</C> — read it as Processing.
        </P>
        <H3>Details to collect</H3>
        <P>
          Each business keeps a list of what it needs from a customer — an address, a request type, a budget. Its team
          edits the list in Corva; you read it from <C>/config</C> as <C>fields</C>. The assistant asks for them in chat
          and on calls; your own forms can show the same fields and send answers as <C>details</C> (
          <C>{`{ key: value }`}</C>). Every chat reply reports what has been collected so far. Do not hard-code the list:
          it changes without a deploy.
        </P>
        <H3>Getting the data out</H3>
        <P>
          Two ways, and most integrations use both. <b>Webhooks</b> push each lead, follow-up and handoff to your system
          the moment it happens. The <b>Records</b> endpoints let you read it back whenever you like — list leads changed
          since your last sync, look a customer up by phone, pull a transcript. Both carry the same two things: the
          business&rsquo;s own <C>details</C> by field key, and <C>request</C> — the booking or callback as fields (date,
          time slot, services, address, reference) rather than a sentence. Filter on anything collected:{" "}
          <C>GET /api/v1/leads?details.service_type=AC%20service</C>.
        </P>
        <H3>Bookings are confirmed by the customer</H3>
        <P>
          The assistant never books on its own say-so. It returns a <C>proposal</C> — a booking (the business&rsquo;s own
          word for it is <C>proposal.noun</C>: a pickup, an appointment, a visit) or a callback — with the details to
          show. Nothing exists until the customer confirms; then Corva creates the customer, the lead, its owner and the
          follow-up, and sends the emails. If the customer types instead of tapping, the card is replaced.
        </P>
        <H3>A person can take over</H3>
        <P>
          Anyone on the business&rsquo;s team can take a chat or a call from the assistant in Corva. In a chat, replies
          then come from <C>GET /api/v1/chat</C> under that person&rsquo;s name. On a voice call the assistant says it is
          transferring the caller, and the person&rsquo;s voice arrives over the same connection — your page keeps
          playing the audio it is sent.
        </P>

        <H2 id="auth">Keys, errors and limits</H2>
        <P>
          Every request carries <C>Authorization: Bearer ck_…</C>. A key belongs to one business; revoking it in Settings
          stops it at once. Requests and responses are JSON (a streamed chat reply is <C>text/event-stream</C>).
        </P>
        <div className="m-scroll">
        <table className="cv-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 14 }}>
          <tbody>
            {[
              ["200", "Done. The body is the result."],
              ["400", "Something in the request is wrong. `error` says what, in words you can show a user."],
              ["401", "The key is missing, wrong, or revoked."],
              ["402", "The business's plan has no room for a new conversation. `error` is safe to show a customer; treat the assistant as offline."],
              ["404", "No conversation or card with that id."],
              ["409", "The chat has ended (start a new sessionId), or a card was answered or replaced already."],
              ["413", "The body is over 64 KB."],
              ["422", "A card can no longer be confirmed as it is — e.g. its date has passed. Show `error` and let them edit."],
              ["429", "Over 300 requests a minute for this business, or one chat sending more than 12 messages a minute. Back off and retry."],
              ["5xx", "Our side. Retry; /leads is safe to retry with the same reference, /chat/confirm with the same proposalId."],
            ].map(([code, text]) => (
              <tr key={code} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                <td style={{ padding: "8px 12px 8px 0", width: 70, fontFamily: MONO, fontWeight: 700 }}>{code}</td>
                <td style={{ padding: "8px 0", color: "var(--color-neutral-800)" }}>{text}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <P>
          Timeouts: a chat reply usually starts within two to four seconds and can take longer when the model is busy —
          allow 30 seconds, or stream. Phone numbers are accepted in any common Indian format and returned as{" "}
          <C>+91 98765 43210</C>. Dates are <C>YYYY-MM-DD</C> in India time; timestamps are ISO 8601 UTC.
        </P>

        <H2 id="reference">API reference</H2>
        <P>
          Base URL <C>{APP_URL}</C>. The same endpoints as a spec:{" "}
          <a href="/api/v1/openapi.json" style={{ color: "var(--color-accent-700)" }}>
            /api/v1/openapi.json
          </a>
          . Example values are from a made-up home-services business; a real business&rsquo;s fields and words come from{" "}
          <C>/config</C>.
        </P>
        {GROUPS.map((g) => (
          <div key={g.name}>
            <h3 id={`ref-${g.name.toLowerCase()}`} style={{ margin: "40px 0 0", fontWeight: 800, fontSize: 20, scrollMarginTop: 20 }}>
              {g.name} <span style={{ fontWeight: 500, fontSize: 14, color: "var(--color-neutral-700)" }}>— {g.blurb}</span>
            </h3>
            {ENDPOINTS.filter((e) => e.group === g.name).map((e) => (
              <EndpointBlock key={`${e.method} ${e.path}`} e={e} />
            ))}
          </div>
        ))}

        <H2 id="voice">Voice calls in the browser</H2>
        <P>
          Your server gets a token from <C>POST /api/v1/voice-sessions</C> and gives the page <C>token</C> and{" "}
          <C>bridgeUrl</C>. The page opens a WebSocket to the bridge and speaks. Calls are push-to-talk: the visitor holds
          a button (or the space bar) while speaking and lets go to hear the answer. The conversation, the details
          collected and anything booked land in the business&rsquo;s console like a phone call.
        </P>
        <Code>{`→ connect   new WebSocket(bridgeUrl)
→ send      {"type":"start","token":"…"}
← receive   {"type":"ready","agent":"Ava","capSeconds":180, …}

  while the visitor holds "talk":
→ send      binary frames — PCM16, mono, 16 kHz
  when they let go:
→ send      {"type":"end_turn"}

← receive   binary frames — PCM16, mono, 24 kHz: play them in order
← receive   {"type":"heard","text":"…"}    what the visitor said, so far
← receive   {"type":"said","text":"…"}     what the assistant said, so far
← receive   {"type":"turn_complete"}

  a person on the team takes the call:
← receive   {"type":"held","by":"Kavya Rao"}   drop any assistant audio still queued
            the assistant says one line handing over; then the person's voice
            arrives as the same 24 kHz binary frames — keep playing them
← receive   {"type":"human","name":"…","text":"…"}  what they said or typed, as a caption
← receive   {"type":"released"}              handed back to the assistant

← receive   {"type":"error","message":"…"}   show it; the call is over
← receive   {"type":"closed","reason":"…","seconds":142}
→ send      {"type":"stop"}                  hang up`}</Code>
        <P>
          <b>Browsers, and iPhones in particular.</b> The microphone only works on an <b>https</b> page (or{" "}
          <C>localhost</C>) — on plain http, Safari never asks for permission and <C>navigator.mediaDevices</C> is
          missing. Ask for the microphone and create your <C>AudioContext</C> in the tap handler itself, before any{" "}
          <C>await</C>, or iOS will neither prompt nor play sound. Use the device&rsquo;s own sample rate and resample to
          16 kHz yourself; iOS does not honour a requested rate. And the bridge must be <b>wss://</b> for an https page —{" "}
          <C>/health</C> tells you (<C>features.voiceSecure</C>); hide the call button when it is false.
        </P>
        <P>
          <b>Limits.</b> An unattended call with the assistant ends at <C>capSeconds</C>; a call a person has taken over
          can run longer. A call with no audio from the visitor for 45 seconds is closed.
        </P>

        <H2 id="webhooks">Webhooks</H2>
        <P>
          The API is your site talking to Corva; a webhook is Corva telling your systems what just happened — to put a
          new lead into your own CRM or order system, post it to a team channel, or start a job. The business adds a URL
          in Corva → <b>Settings → Webhooks</b>, chooses the events, and is shown a signing secret (<C>whsec_…</C>) once.
        </P>
        <div className="m-scroll">
        <table className="cv-table" style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 14 }}>
          <tbody>
            {WEBHOOK_EVENTS.map((e) => (
              <tr key={e.type} style={{ borderBottom: "1px solid var(--color-neutral-300)", verticalAlign: "top" }}>
                <td style={{ padding: "8px 12px 8px 0", width: 190, fontFamily: MONO, fontWeight: 700 }}>{e.type}</td>
                <td style={{ padding: "8px 0", color: "var(--color-neutral-800)" }}>{e.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <P>
          Each delivery is one <C>POST</C> with a JSON body and two headers: <C>Corva-Event</C> (the type) and{" "}
          <C>Corva-Signature</C>. Answer <C>2xx</C> within six seconds. A <C>5xx</C> or no answer is retried once; treat
          webhooks as notifications and the API as the record — and be ready to receive the same event twice (
          <C>id</C> is unique per event).
        </P>
        <Code>{JSON.stringify(
          { id: "evt_3f9c0a1b2c3d4e5f6a7b8c9d", type: "lead.created", createdAt: "2026-10-03T04:31:13.000Z", data: WEBHOOK_EXAMPLES["lead.created"] },
          null,
          2,
        )}</Code>
        <P>
          <b>Verify every delivery.</b> The signature is an HMAC-SHA256 of <C>{`"<t>.<raw body>"`}</C> with your secret,
          hex-encoded. Use the raw request body, exactly as received, and reject a timestamp more than five minutes old.
        </P>
        <Code>{`import { createHmac, timingSafeEqual } from "node:crypto";

// Next.js route handler: app/api/corva-webhook/route.ts
export async function POST(req: Request) {
  const body = await req.text();                       // raw, before any JSON.parse
  const header = req.headers.get("corva-signature") ?? "";
  const t = header.match(/t=(\\d+)/)?.[1];
  const v1 = header.match(/v1=([0-9a-f]+)/)?.[1];
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return new Response("stale", { status: 400 });

  const expected = createHmac("sha256", process.env.CORVA_WEBHOOK_SECRET!).update(\`\${t}.\${body}\`).digest("hex");
  if (expected.length !== v1.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) {
    return new Response("bad signature", { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.type === "lead.created") await addToOurSystem(event.data.lead, event.data.customer);
  return new Response("ok");
}`}</Code>
        <P>
          <C>Send test</C> in Settings posts a <C>ping</C> event to your URL and shows what it answered. The other
          payloads — <C>lead.updated</C>, <C>follow_up.created</C>, <C>handoff.requested</C>, <C>conversation.ended</C> —
          are in the{" "}
          <a href="/api/v1/openapi.json" style={{ color: "var(--color-accent-700)" }}>
            OpenAPI spec
          </a>{" "}
          under <C>webhooks</C>.
        </P>

        <H2 id="payments">Taking payments</H2>
        <P>
          The team in the console, and the assistant on a chat, WhatsApp or a call, can ask a customer to pay. The money
          is the business&rsquo;s: <b>your</b> system makes the payment link with <b>your</b> payment account (Razorpay,
          or any other), so no payment key ever reaches Corva. The business sets your endpoint in Corva →{" "}
          <b>Settings → Payments</b> and is shown a signing secret (<C>cps_…</C>) once.
        </P>
        <P>
          When a payment is asked for, Corva sends your endpoint one <C>POST</C>, signed exactly like a webhook (
          <C>Corva-Signature</C>, verified the same way as above, with this secret). Answer within 15 seconds with the
          payment as you made it — the same fields you would send to <C>POST /api/v1/payments</C>. The assistant only
          ever sends an <C>orderReference</C>: it never names an amount, so work out what is owed from your own order.
          A person in the console may send <C>amountRupees</C>. If you cannot make a link, answer <C>4xx</C> with{" "}
          <C>{`{ "error": "…" }`}</C> in words the customer may be told (&ldquo;There is no bill on this order yet&rdquo;).
          The same <C>requestId</C> twice must return the same link.
        </P>
        <P>
          Discounts never come from the model. A business publishes its <b>offers</b> in Corva (a code, a percentage with
          a cap or a flat amount, a minimum order, dates, first order only, once per customer); when a customer names one,
          Corva checks it in code and, only if it applies, sends it as <C>offer</C>. Take it off the amount you work out —
          <C>value</C> is a percentage when <C>kind</C> is <C>&quot;percent&quot;</C>, rupees when it is{" "}
          <C>&quot;flat&quot;</C> — or answer <C>4xx</C> if your order does not qualify. No <C>offer</C>, no discount.
        </P>
        <P>
          Before your endpoint is called for the assistant, two checks happen in Corva, both on by default (Settings →
          Payments): the customer proves who they are with a code, and a person on the team approves the request. So a
          request may reach you some minutes after the customer asked, with <C>requestedBy</C> naming who approved it.
        </P>
        <Code>{JSON.stringify(
          {
            requestId: "cpr_5c1f9a0b3d2e4f6a7b8c9d0e",
            orderReference: "AH-7K3QX9",
            customer: { id: "c1d2…", name: "Riya Sharma", phone: "+91 98765 43210" },
            conversationId: "3e4f…",
            requestedBy: "Ava (AI), approved by Kavya Rao",
            notify: true,
            offer: { code: "FIRST20", title: "20% off your first order", kind: "percent", value: 20, maxDiscountRupees: 200, minOrderRupees: 500 },
          },
          null,
          2,
        )}</Code>
        <P>
          Then, whenever it changes — above all when your payment provider says it is paid — send its state to{" "}
          <C>POST /api/v1/payments</C>. Corva shows it on the customer&rsquo;s record and in the conversation, thanks the
          customer on WhatsApp, and the assistant can answer &ldquo;has my payment gone through?&rdquo;.
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

        <H2 id="golive">Going live</H2>
        <ul style={{ margin: "12px 0 0", paddingLeft: 20, fontSize: 15, lineHeight: 1.7, color: "var(--color-neutral-800)" }}>
          <li>The key is only in your server&rsquo;s environment, and <C>/health</C> answers <C>ok</C> from production.</li>
          <li>The site reads <C>/config</C> rather than hard-coding the assistant&rsquo;s name, fields or booking word.</li>
          <li>A chat keeps one <C>sessionId</C>; a new chat gets a new one; <C>visitorId</C> goes on every call.</li>
          <li>Cards lock the input until Confirm or Edit, and a <C>409</C> or <C>422</C> from confirm is shown, not swallowed.</li>
          <li>Closing the chat or reloading the page sends <C>/chat/end</C>, and a <C>409</C> on the next message starts a new <C>sessionId</C>.</li>
          <li>The chat polls <C>GET /chat</C> so a person taking over is seen, and shows their name.</li>
          <li>The voice button is hidden unless <C>features.voice</C> (and <C>voiceSecure</C> on https) is true.</li>
          <li>Your own rate limit sits in front of your chat route — the business&rsquo;s 300 requests a minute are shared by all your visitors, and one chat may send 12 messages a minute.</li>
          <li>Webhook deliveries are verified, and a repeat of the same <C>id</C> does nothing twice.</li>
          <li>The business has checked its knowledge, its Details to collect and who on the team gets leads.</li>
        </ul>

        <p style={{ marginTop: 56, fontSize: 13, color: "var(--color-neutral-700)" }}>
          Corva API {"v1"} · additions are backwards-compatible within v1: expect new fields and new event types, and
          ignore what you do not know. Questions: ask whoever at the business gave you the key, or Corva support.
        </p>
      </div>
    </main>
  );
}
