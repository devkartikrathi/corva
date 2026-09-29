/**
 * Corva's public API, described once.
 *
 * Served as OpenAPI at /api/v1/openapi.json (for tools and generated clients)
 * and read by the /developers page, so the reference a developer reads and the
 * spec their tooling reads cannot drift apart.
 */

export const API_VERSION = "v1";

const leadExample = {
  kind: "pickup",
  name: "Riya Sharma",
  phone: "98765 43210",
  email: "riya@example.com",
  services: ["Laundry: Wash, Fold & Ironing"],
  address: "B-402, Palm Grove, Sector 70, Gurugram",
  pickupDate: "2026-10-04",
  timeSlot: "8–10 AM",
  reference: "TD-7K3QX9",
  visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d",
  sessionId: "chat_8c1f2a",
};

export type Endpoint = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  description: string;
  request?: Record<string, { type: string; required?: boolean; description: string }>;
  query?: Record<string, { type: string; required?: boolean; description: string }>;
  example?: unknown;
  response: unknown;
};

export const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/health",
    summary: "Check your key and what you can use",
    description:
      "The first call to make. Confirms the key, and says which features this business has — call it when your site starts, and hide the voice button when `features.voice` is false.",
    response: {
      ok: true,
      business: "Tumble Days",
      assistant: "Tumbly",
      phoneNumber: "+91 40 7573 2715",
      knowledgeDocuments: 2,
      features: { chat: true, leads: true, voice: true, voiceSecure: true },
      apiVersion: "v1",
    },
  },
  {
    method: "POST",
    path: "/api/v1/chat",
    summary: "Talk to the business's AI agent",
    description:
      "For sites that do not run their own AI. Send one customer message, get the agent's reply. The agent answers only from the business's knowledge, keeps within its limits, and records leads, follow-ups and handoffs to the team — exactly as it does on the phone. Keep one `sessionId` per chat.",
    request: {
      sessionId: { type: "string", required: true, description: "Your id for this chat, 6–80 of [A-Za-z0-9_-]. Reuse it for every message in the chat." },
      message: { type: "string", required: true, description: "What the customer typed. Up to 2,000 characters." },
      visitorId: { type: "string", description: "Your visitor cookie value, to join the chat to their visit." },
      customer: { type: "object", description: "{ name?, phone?, email? } — what you already know about them." },
    },
    example: { sessionId: "chat_8c1f2a", message: "Do you pick up from Sector 56?", visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d" },
    response: {
      conversationId: "0b7c…",
      reply: "Yes — free doorstep pickup across Gurugram, including Sector 56. What would you like cleaned?",
      heldBy: null,
      actions: [{ label: "New lead: Riya Sharma", allowed: true }],
      escalation: null,
      closed: false,
    },
  },
  {
    method: "GET",
    path: "/api/v1/chat",
    summary: "Replies from a person who took the chat over",
    description:
      "When a person on the team takes a chat over, `POST /api/v1/chat` returns `heldBy` and no `reply`. Poll this every few seconds for what they write.",
    query: {
      sessionId: { type: "string", required: true, description: "The chat's sessionId." },
      after: { type: "number", description: "Only messages after this ordinal. Start at -1." },
    },
    response: { heldBy: "Kavya Rao", ended: false, messages: [{ ordinal: 4, from: "Kavya Rao", text: "Hi Riya, I can help with that." }] },
  },
  {
    method: "POST",
    path: "/api/v1/leads",
    summary: "Send a booking, callback request or enquiry",
    description:
      "For your own forms, or your own AI's actions. Corva finds or creates the customer by phone, opens (or updates) their lead with an owner on the team, puts a follow-up on that person's list, emails the customer a confirmation and tells the owner. Safe to retry: sending the same `reference` again returns the first result with `duplicate: true`.",
    request: {
      kind: { type: '"pickup" | "callback" | "enquiry"', required: true, description: "What they asked for." },
      name: { type: "string", required: true, description: "Their name." },
      phone: { type: "string", required: true, description: "Their mobile, any common Indian format." },
      email: { type: "string", description: "Where the confirmation goes. Strongly recommended." },
      reference: { type: "string", description: "Your reference for this request — also the idempotency key." },
      services: { type: "string[]", description: "What needs doing." },
      address: { type: "string", description: "For a pickup or visit." },
      pickupDate: { type: "string", description: "YYYY-MM-DD." },
      timeSlot: { type: "string", description: "e.g. \"8–10 AM\"." },
      preferredTime: { type: "string", description: "For a callback, e.g. \"today after 6 PM\"." },
      topic: { type: "string", description: "What they want to talk about." },
      notes: { type: "string", description: "Anything else." },
      promoCode: { type: "string", description: "An offer code they used." },
      visitorId: { type: "string", description: "Your visitor cookie, to join the request to their visit." },
      sessionId: { type: "string", description: "The chat it came from, if any." },
    },
    example: leadExample,
    response: {
      reference: "TD-7K3QX9",
      customerId: "a734…",
      leadId: "c505…",
      followUp: { id: "0472…", assignee: "Kavya Rao", dueAt: "2026-10-03T05:30:00.000Z" },
      emailed: { customer: true, team: true },
      duplicate: false,
    },
  },
  {
    method: "POST",
    path: "/api/v1/chats",
    summary: "Mirror your own chat's transcript",
    description:
      "If your site runs its own chat assistant, send the whole transcript after each reply. Corva keeps one conversation per `sessionId` (replacing the transcript each time), so the team can read every chat live and see where a request came from.",
    request: {
      sessionId: { type: "string", required: true, description: "Your chat id." },
      visitorId: { type: "string", description: "Your visitor cookie." },
      messages: { type: '{ role: "user" | "assistant", text: string }[]', required: true, description: "The whole conversation so far." },
    },
    example: {
      sessionId: "chat_8c1f2a",
      visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d",
      messages: [
        { role: "user", text: "Do you clean silk sarees?" },
        { role: "assistant", text: "Yes — they go to our premium dry-cleaning." },
      ],
    },
    response: { conversationId: "e57e…", turns: 2 },
  },
  {
    method: "POST",
    path: "/api/v1/visits",
    summary: "Record a visitor, with their cookie consent",
    description:
      "Tell Corva a visitor is on the site. With `consent: \"necessary\"` only the visitor id is kept. With `\"all\"` (they accepted analytics cookies), the page, referrer and utm_ campaign are kept too, and show on the customer's record once they identify themselves. Always send the consent your banner actually recorded.",
    request: {
      visitorId: { type: "string", required: true, description: "Your first-party visitor id (8–80 chars)." },
      consent: { type: '"necessary" | "all"', required: true, description: "What they chose on your cookie banner." },
      type: { type: "string", description: "\"page_view\" (default) or \"consent\"." },
      path: { type: "string", description: "Only kept with consent \"all\"." },
      referrer: { type: "string", description: "Only kept with consent \"all\"." },
      utm: { type: "object", description: "utm_source, utm_medium, utm_campaign… Only kept with consent \"all\"." },
    },
    example: { visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d", consent: "all", type: "page_view", path: "/", referrer: "https://instagram.com", utm: { utm_source: "instagram" } },
    response: { recorded: true },
  },
  {
    method: "POST",
    path: "/api/v1/voice-sessions",
    summary: "Start a voice call from the visitor's browser",
    description:
      "Your server asks for a token (the API key must never reach the browser), and hands `token` and `bridgeUrl` to the page, which opens a WebSocket to the bridge and speaks to the assistant. Tokens last five minutes and work for one call. See “Voice calls in the browser” below for the protocol.",
    request: {
      visitorId: { type: "string", description: "Your visitor cookie." },
      name: { type: "string", description: "Their name, if known — the assistant greets them by it." },
      phone: { type: "string", description: "Their number, if known — joins the call to their record." },
    },
    example: { visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d", name: "Riya Sharma", phone: "9876543210" },
    response: { token: "eyJicmFuZElkIjoi…", expiresInSeconds: 300, bridgeUrl: "wss://voice.example.com", agentName: "Tumbly" },
  },
];

/** The same endpoints as an OpenAPI 3.1 document. */
export function openApiDocument(baseUrl: string) {
  const schemaOf = (fields?: Endpoint["request"]) =>
    fields
      ? {
          type: "object",
          required: Object.entries(fields)
            .filter(([, f]) => f.required)
            .map(([k]) => k),
          properties: Object.fromEntries(
            Object.entries(fields).map(([k, f]) => [k, { description: `${f.type} — ${f.description}` }]),
          ),
        }
      : undefined;

  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    paths[e.path] ??= {};
    paths[e.path][e.method.toLowerCase()] = {
      summary: e.summary,
      description: e.description,
      security: [{ apiKey: [] }],
      ...(e.query
        ? {
            parameters: Object.entries(e.query).map(([name, q]) => ({
              name,
              in: "query",
              required: Boolean(q.required),
              description: q.description,
              schema: { type: q.type === "number" ? "number" : "string" },
            })),
          }
        : {}),
      ...(e.request
        ? { requestBody: { required: true, content: { "application/json": { schema: schemaOf(e.request), example: e.example } } } }
        : {}),
      responses: {
        "200": { description: "OK", content: { "application/json": { example: e.response } } },
        "400": { description: "The request is wrong — the message says how." },
        "401": { description: "Missing, invalid or revoked API key." },
        "429": { description: "Too many requests — 120 a minute per key." },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Corva API",
      version: API_VERSION,
      description:
        "Connect a business's website to its Corva AI assistant: chat, leads, visitors and voice. Every call is made from your server with the business's API key.",
    },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "ck_… from Corva → Settings → Website & API keys" } } },
    paths,
  };
}
