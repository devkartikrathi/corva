import { WEBHOOK_EVENTS } from "./webhooks";

/**
 * Corva's public API, described once.
 *
 * Served as OpenAPI at /api/v1/openapi.json (for tools and generated clients)
 * and read by the /developers page, so the reference a developer reads and the
 * spec their tooling reads cannot drift apart.
 *
 * The examples are one made-up business — "Acme Home Services", whose
 * assistant is "Ava" — because every business's own fields, booking word and
 * stage names differ. Nothing here is specific to one customer: what a real
 * business collects and books comes from GET /api/v1/config.
 */

export const API_VERSION = "v1";

const customer = { id: "a734…", name: "Riya Sharma", phone: "+91 98765 43210", email: "riya@example.com" };

const leadObject = {
  id: "c505…",
  name: "Riya Sharma",
  phone: "+91 98765 43210",
  email: "riya@example.com",
  interest: "AC service · visit 2026-10-04, 8–10 AM · B-402, Palm Grove, Sector 70",
  notes: "Ref AH-7K3QX9",
  stage: "qualified",
  stageLabel: "Visit booked",
  valueRupees: null,
  source: "web_chat",
  createdByAi: true,
  owner: "Kavya Rao",
  details: { address: "B-402, Palm Grove, Sector 70", service_type: "AC service", units: "2 split ACs" },
  request: {
    kind: "booking",
    reference: "AH-7K3QX9",
    services: ["AC service"],
    address: "B-402, Palm Grove, Sector 70",
    date: "2026-10-04",
    timeSlot: "8–10 AM",
  },
  customerId: "a734…",
  conversationId: "0b7c…",
  createdAt: "2026-10-03T04:31:12.000Z",
  updatedAt: "2026-10-03T04:31:12.000Z",
};

const conversationObject = {
  id: "0b7c…",
  channel: "chat",
  status: "resolved",
  outcome: "ai_resolved",
  intent: "Book an AC service",
  summary: "Booked an AC service visit for Saturday morning.",
  handledBy: null,
  isTest: false,
  customerId: "a734…",
  sessionId: "chat_8c1f2a",
  details: { address: "B-402, Palm Grove, Sector 70", service_type: "AC service" },
  startedAt: "2026-10-03T04:28:40.000Z",
  endedAt: "2026-10-03T04:31:55.000Z",
  durationSeconds: 195,
};

export type Field = { type: string; required?: boolean; description: string };

export type Endpoint = {
  method: "GET" | "POST";
  path: string;
  /** Which part of the docs it belongs under. */
  group: "Setup" | "Chat" | "Leads" | "Records" | "Visitors" | "Voice";
  summary: string;
  description: string;
  request?: Record<string, Field>;
  query?: Record<string, Field>;
  example?: unknown;
  response: unknown;
};

export const ENDPOINTS: Endpoint[] = [
  {
    method: "GET",
    path: "/api/v1/health",
    group: "Setup",
    summary: "Check your key",
    description:
      "The first call to make. Confirms the key belongs to a business and says which features are on. Cheap enough to call when your server starts.",
    response: {
      ok: true,
      business: "Acme Home Services",
      assistant: "Ava",
      phoneNumber: "+91 40 7573 2715",
      knowledgeDocuments: 3,
      features: { chat: true, leads: true, voice: true, voiceSecure: true },
      apiVersion: "v1",
    },
  },
  {
    method: "GET",
    path: "/api/v1/config",
    group: "Setup",
    summary: "How the business is set up",
    description:
      "Everything your site needs so it does not hard-code the business: the assistant's name, what can be booked, and `fields` — the business's Details to collect, which its team edits in Corva. Build your own forms from `fields` and send answers back as `details` (keyed by `key`); the assistant asks for the same ones in chat and on calls. Read it at start-up or cache it for a few minutes: when the business adds a field, your site picks it up without a deploy.",
    response: {
      business: "Acme Home Services",
      assistant: "Ava",
      industry: { key: "home_services", label: "Home services" },
      phoneNumber: "+91 40 7573 2715",
      features: { chat: true, leads: true, voice: true, voiceSecure: true },
      booking: { noun: "visit", needsAddress: true, maxDaysAhead: 30 },
      fields: [
        { key: "name", label: "Name", hint: null, kind: "text", options: [], required: true },
        { key: "phone", label: "Phone number", hint: "A mobile number to reach them on", kind: "phone", options: [], required: true },
        { key: "email", label: "Email", hint: "Where confirmations go", kind: "email", options: [], required: false },
        { key: "address", label: "Address", hint: "Flat, building and area", kind: "address", options: [], required: true },
        { key: "service_type", label: "Service", hint: null, kind: "choice", options: ["AC service", "Plumbing", "Electrical"], required: true },
      ],
      apiVersion: "v1",
    },
  },
  {
    method: "POST",
    path: "/api/v1/chat",
    group: "Chat",
    summary: "Send a customer's message to the assistant",
    description:
      "One message in, the assistant's reply out. It answers only from the business's knowledge (kept in Corva), stays within the limits the business set, collects the business's details as the conversation goes, and hands over to a person when it should. Keep one `sessionId` per chat.\n\nWhen it has what a booking or a callback needs, it does not make it — it returns a `proposal`. Show that as a card with Confirm and Edit and send the customer's answer to `POST /api/v1/chat/confirm`. A new message replaces an unanswered card.\n\n`details` is everything collected so far, keyed by the business's field keys. `heldBy` is set once a person on the team has taken the chat over: `reply` is then null, and their replies come from `GET /api/v1/chat`.\n\nWith `stream: true` the answer is `text/event-stream`: `delta` events (`{ text }`) while the reply is written, a `proposal` event when a card should show, then `done` with the same body as the JSON answer — or `error`.",
    request: {
      sessionId: { type: "string", required: true, description: "Your id for this chat: 6–80 of [A-Za-z0-9_-]. Reuse it for every message in the chat; start a new one for a new chat." },
      message: { type: "string", required: true, description: "What the customer typed. Up to 2,000 characters." },
      visitorId: { type: "string", description: "Your first-party visitor id, to join the chat to their visits and later calls." },
      customer: { type: "object", description: "{ name?, phone?, email? } — what you already know about them (a signed-in user, say). The assistant will not ask again." },
      stream: { type: "boolean", description: "Answer as server-sent events, to show the reply as it is written." },
    },
    example: { sessionId: "chat_8c1f2a", message: "My AC is leaking. Can someone come tomorrow morning? I'm Riya, 98765 43210, B-402 Palm Grove, Sector 70", visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d" },
    response: {
      conversationId: "0b7c…",
      reply: "Please check the details below and tap Confirm.",
      heldBy: null,
      actions: [],
      escalation: null,
      closed: false,
      proposal: {
        id: "5f0e…",
        kind: "booking",
        noun: "visit",
        details: {
          name: "Riya",
          phone: "98765 43210",
          address: "B-402 Palm Grove, Sector 70",
          services: ["AC service"],
          date: "2026-10-04",
          timeSlot: "8–10 AM",
          notes: "AC leaking",
        },
        extra: [{ label: "Units", value: "1 split AC" }],
      },
      details: { name: "Riya", phone: "+91 98765 43210", address: "B-402 Palm Grove, Sector 70", service_type: "AC service" },
    },
  },
  {
    method: "POST",
    path: "/api/v1/chat/confirm",
    group: "Chat",
    summary: "The customer's Confirm or Edit on a card",
    description:
      "Confirm makes what the card shows: the customer's record, a lead with an owner on the team, a follow-up on that person's list, a confirmation email to the customer and a note to the owner. `reply` is the line to show in the chat and `receipt` is for the card. Edit tells the assistant they want to change something — show the `reply` and let them type. Confirming the same card twice returns the first result with `duplicate: true`.",
    request: {
      sessionId: { type: "string", required: true, description: "The chat's sessionId." },
      proposalId: { type: "string", required: true, description: "`proposal.id` from the chat reply." },
      approved: { type: "boolean", required: true, description: "true for Confirm, false for Edit." },
      visitorId: { type: "string", description: "Your visitor id, to join the booking to their visits." },
    },
    example: { sessionId: "chat_8c1f2a", proposalId: "5f0e…", approved: true, visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d" },
    response: {
      conversationId: "0b7c…",
      reply: "Done — your visit is booked. Your reference is **AH-7K3QX9**. Kavya from our team will call you shortly to confirm. A confirmation is on its way to your inbox.",
      proposal: { id: "5f0e…", status: "confirmed" },
      receipt: { reference: "AH-7K3QX9", owner: "Kavya Rao", emailed: true },
      duplicate: false,
    },
  },
  {
    method: "GET",
    path: "/api/v1/chat",
    group: "Chat",
    summary: "Replies from a person who took the chat over",
    description:
      "Anyone on the business's team can take a chat over from the assistant in Corva. Poll this — every eight seconds or so while a chat is open, every three once `heldBy` is set — and show messages whose `from` is not \"assistant\" under that person's name. `heldBy` goes back to null when they hand the chat back; `ended` means start a new sessionId.",
    query: {
      sessionId: { type: "string", required: true, description: "The chat's sessionId." },
      after: { type: "number", description: "Only messages after this ordinal. Start at -1, then pass the highest ordinal you have seen." },
    },
    response: { heldBy: "Kavya Rao", ended: false, messages: [{ ordinal: 6, from: "Kavya Rao", text: "Hi Riya, Kavya here — I can get someone to you by 9." }] },
  },
  {
    method: "POST",
    path: "/api/v1/chats",
    group: "Chat",
    summary: "Mirror your own assistant's transcript",
    description:
      "Only if your site runs its own chat assistant instead of Corva's. Send the whole transcript after each reply; Corva keeps one conversation per `sessionId`, replacing it each time, so the team can read every chat live and see where a request came from.",
    request: {
      sessionId: { type: "string", required: true, description: "Your chat id." },
      visitorId: { type: "string", description: "Your visitor id." },
      messages: { type: '{ role: "user" | "assistant", text: string }[]', required: true, description: "The whole conversation so far." },
    },
    example: {
      sessionId: "chat_8c1f2a",
      visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d",
      messages: [
        { role: "user", text: "Do you service window ACs?" },
        { role: "assistant", text: "Yes — window and split units both." },
      ],
    },
    response: { conversationId: "e57e…", turns: 2 },
  },
  {
    method: "POST",
    path: "/api/v1/leads",
    group: "Leads",
    summary: "Send a booking, callback request or enquiry",
    description:
      "For your own forms — a booking form, a \"call me back\" button, a contact page. Corva finds or creates the customer by phone, opens (or updates) their lead with an owner on the team, puts a follow-up on that person's list, emails the customer a confirmation and tells the owner. `kind: \"booking\"` is whatever the business books (see `booking.noun` in /config); the lead starts further along its pipeline than a callback or an enquiry.\n\nSend the business's own fields as `details`, keyed by the `key`s from /config — unknown keys are ignored, choices are matched to the business's options. Safe to retry: the same `reference` again returns the first result with `duplicate: true`.",
    request: {
      kind: { type: '"booking" | "callback" | "enquiry"', required: true, description: "What they asked for. (\"pickup\" is accepted as another word for \"booking\".)" },
      name: { type: "string", required: true, description: "Their name." },
      phone: { type: "string", required: true, description: "Their mobile, in any common Indian format." },
      email: { type: "string", description: "Where the confirmation goes. Strongly recommended." },
      reference: { type: "string", description: "Your reference for this request — also the idempotency key. Corva makes one if you do not." },
      details: { type: "object", description: "The business's Details to collect: { key: value }, keys from GET /config." },
      services: { type: "string[]", description: "What they want done, for a booking." },
      address: { type: "string", description: "Where, when the booking needs an address." },
      date: { type: "string", description: "For a booking: YYYY-MM-DD." },
      timeSlot: { type: "string", description: "For a booking, e.g. \"8–10 AM\"." },
      preferredTime: { type: "string", description: "For a callback, e.g. \"today after 6 PM\"." },
      topic: { type: "string", description: "What they want to talk about." },
      notes: { type: "string", description: "Anything else." },
      promoCode: { type: "string", description: "An offer code they used." },
      visitorId: { type: "string", description: "Your visitor id, to join the request to their visits." },
      sessionId: { type: "string", description: "The chat it came from, if your own assistant took it (see /chats)." },
    },
    example: {
      kind: "booking",
      name: "Riya Sharma",
      phone: "98765 43210",
      email: "riya@example.com",
      reference: "AH-7K3QX9",
      services: ["AC service"],
      address: "B-402, Palm Grove, Sector 70",
      date: "2026-10-04",
      timeSlot: "8–10 AM",
      details: { service_type: "AC service", units: "2 split ACs" },
      visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d",
    },
    response: {
      reference: "AH-7K3QX9",
      customerId: "a734…",
      leadId: "c505…",
      isNew: true,
      followUp: { id: "0472…", assignee: "Kavya Rao", dueAt: "2026-10-03T05:30:00.000Z" },
      emailed: { customer: true, team: true },
      duplicate: false,
    },
  },
  {
    method: "GET",
    path: "/api/v1/leads",
    group: "Records",
    summary: "List and filter leads",
    description:
      "The business's leads, newest-changed first — whichever way they arrived: chat, a call, your forms, or added by hand. Each carries `details` (the business's own Details to collect, by field key) and `request` (the latest booking, callback or enquiry as fields: date, time slot, services, address, reference).\n\nFilter on any collected detail with `details.<key>=<value>` — keys from `/config`, matched case-insensitively; `details.<key>=` with no value means \"has an answer\". Because details are stored by key, a field the business adds tomorrow is filterable tomorrow with no change here.\n\nPage with `cursor`: pass back `nextCursor` until it is null. For a sync, poll `updatedSince` with the time of your last run.",
    query: {
      stage: { type: "string", description: "One or more of new, contacted, qualified, proposal, won, lost — comma-separated. `stageLabel` in the result is the business's own word for it." },
      since: { type: "string", description: "Created at or after this time (ISO 8601)." },
      updatedSince: { type: "string", description: "Changed at or after this time — what a sync asks for." },
      "details.<key>": { type: "string", description: "A collected detail equals this, e.g. details.service_type=AC service. Repeat for several." },
      phone: { type: "string", description: "The lead's phone number, any format." },
      reference: { type: "string", description: "The reference a booking or callback was given." },
      q: { type: "string", description: "Text in the name, the request or the notes." },
      limit: { type: "number", description: "1–100, default 25." },
      cursor: { type: "string", description: "`nextCursor` from the previous page." },
    },
    response: { leads: [leadObject], nextCursor: null },
  },
  {
    method: "GET",
    path: "/api/v1/leads/{id}",
    group: "Records",
    summary: "One lead",
    description: "A lead with its customer and its follow-ups — who owes the customer what, by when, and whether it was done.",
    response: {
      lead: leadObject,
      customer: { ...customer, address: "B-402, Palm Grove, Sector 70" },
      followUps: [
        { id: "0472…", title: "Confirm visit with Riya Sharma for 2026-10-04, 8–10 AM", detail: "Ref AH-7K3QX9", dueAt: "2026-10-03T05:30:00.000Z", status: "open", assignee: "Kavya Rao", outcome: null, completedAt: null },
      ],
    },
  },
  {
    method: "POST",
    path: "/api/v1/leads/{id}",
    group: "Records",
    summary: "Update a lead from your system",
    description:
      "Keep Corva in step with your own system: when your job is done, move the lead to `won`; add what your team learnt. Send only what changes. Returns the lead as `GET` does, and tells webhooks (`lead.updated`) like a change made in the console.",
    request: {
      stage: { type: "string", description: "new, contacted, qualified, proposal, won or lost." },
      lostReason: { type: "string", description: "Why, when the stage is lost." },
      notes: { type: "string", description: "Replaces the lead's notes." },
      valueRupees: { type: "number", description: "What the lead is worth, in rupees; null to clear." },
      details: { type: "object", description: "{ key: value } — merged into the lead's details; keys from GET /config." },
    },
    example: { stage: "won", valueRupees: 1800, details: { units: "2 split ACs" } },
    response: { lead: { ...leadObject, stage: "won", stageLabel: "Job done", valueRupees: 1800 }, customer: { ...customer, address: "B-402, Palm Grove, Sector 70" }, followUps: [] },
  },
  {
    method: "GET",
    path: "/api/v1/customers",
    group: "Records",
    summary: "List and find customers",
    description: "Everyone the business has a record for, newest first. Look one up by `phone` or `email` to recognise a returning customer in your own app.",
    query: {
      phone: { type: "string", description: "Their phone number, any format." },
      email: { type: "string", description: "Their email address." },
      q: { type: "string", description: "Text in the name, email or phone." },
      since: { type: "string", description: "Created at or after this time." },
      limit: { type: "number", description: "1–100, default 25." },
      cursor: { type: "string", description: "`nextCursor` from the previous page." },
    },
    response: {
      customers: [{ ...customer, address: "B-402, Palm Grove, Sector 70", owner: "Kavya Rao", leads: 2, openLeads: 1, lastConversationAt: "2026-10-03T04:28:40.000Z", createdAt: "2026-09-12T10:02:11.000Z" }],
      nextCursor: null,
    },
  },
  {
    method: "GET",
    path: "/api/v1/customers/{id}",
    group: "Records",
    summary: "One customer",
    description: "A customer with everything collected about them (`details`: the newest answer to each of the business's fields, across all their leads), their leads and their conversations.",
    response: {
      customer: { ...customer, address: "B-402, Palm Grove, Sector 70", owner: "Kavya Rao", createdAt: "2026-09-12T10:02:11.000Z" },
      details: { address: "B-402, Palm Grove, Sector 70", service_type: "AC service", units: "2 split ACs" },
      leads: [leadObject],
      conversations: [conversationObject],
    },
  },
  {
    method: "GET",
    path: "/api/v1/conversations",
    group: "Records",
    summary: "List chats and calls",
    description: "Conversations, newest first, each with the `details` it collected. The owner's own test conversations are left out unless you ask for them.",
    query: {
      channel: { type: "string", description: "\"chat\" or \"voice\"." },
      since: { type: "string", description: "Started at or after this time." },
      sessionId: { type: "string", description: "The chat your site started under this sessionId." },
      customerId: { type: "string", description: "One customer's conversations." },
      "details.<key>": { type: "string", description: "A detail collected in the conversation equals this." },
      includeTests: { type: "string", description: "\"true\" to include conversations from Try it." },
      limit: { type: "number", description: "1–100, default 25." },
      cursor: { type: "string", description: "`nextCursor` from the previous page." },
    },
    response: { conversations: [conversationObject], nextCursor: null },
  },
  {
    method: "GET",
    path: "/api/v1/conversations/{id}",
    group: "Records",
    summary: "One conversation, with its transcript",
    description: "`from` is \"customer\", \"assistant\", \"system\" (an event: a takeover, the call ending) or the name of the person on the team who spoke.",
    response: {
      conversation: conversationObject,
      customer: { ...customer, address: "B-402, Palm Grove, Sector 70" },
      transcript: [
        { ordinal: 0, from: "customer", text: "My AC is leaking. Can someone come tomorrow morning?", atSeconds: 0 },
        { ordinal: 1, from: "assistant", text: "Please check the details below and tap Confirm.", atSeconds: 4 },
      ],
    },
  },
  {
    method: "POST",
    path: "/api/v1/visits",
    group: "Visitors",
    summary: "Record a visitor, with their cookie consent",
    description:
      "Tell Corva a visitor is on the site. With `consent: \"necessary\"` only the visitor id is kept. With `\"all\"` (they accepted analytics cookies), the page, referrer and utm_ campaign are kept too, and show on the customer's record once they identify themselves — so the team sees that this lead came from an Instagram ad. Always send the consent your banner actually recorded.",
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
    group: "Voice",
    summary: "Start a voice call from the visitor's browser",
    description:
      "Your server asks for a token (the API key must never reach the browser) and hands `token` and `bridgeUrl` to the page, which opens a WebSocket to the bridge and speaks to the assistant. Tokens last five minutes and start one call. The protocol is under “Voice calls in the browser”.",
    request: {
      visitorId: { type: "string", description: "Your visitor id." },
      name: { type: "string", description: "Their name, if known — the assistant greets them by it." },
      phone: { type: "string", description: "Their number, if known — joins the call to their record." },
    },
    example: { visitorId: "v_3f9c0a1b2c3d4e5f6a7b8c9d", name: "Riya Sharma", phone: "9876543210" },
    response: { token: "eyJicmFuZElkIjoi…", expiresInSeconds: 300, bridgeUrl: "wss://app.example.com/api/voice", agentName: "Ava" },
  },
];

/** What each webhook event carries, for the docs and the spec. */
export const WEBHOOK_EXAMPLES: Record<string, unknown> = {
  // `request` at the top level means this event *is* that request, made just
  // now. `lead.request` is on every lead event: the latest request, whatever
  // caused the event.
  "lead.created": { lead: leadObject, customer, request: leadObject.request },
  "lead.updated": { lead: { ...leadObject, stage: "won", stageLabel: "Job done" }, customer },
  "follow_up.created": {
    followUp: {
      id: "0472…",
      title: "Confirm visit with Riya Sharma for 2026-10-04, 8–10 AM",
      detail: "AC service · visit 2026-10-04, 8–10 AM\nRef AH-7K3QX9",
      dueAt: "2026-10-03T05:30:00.000Z",
      assignee: "Kavya Rao",
      createdByAi: true,
      leadId: "c505…",
      conversationId: "0b7c…",
    },
    customer,
  },
  "handoff.requested": {
    handoff: { id: "9d21…", kind: "escalation", reason: "Asked for a refund above the assistant's limit", headline: "Wants ₹4,500 back for a repeat visit", routedTo: "Kavya Rao" },
    conversation: { id: "0b7c…", channel: "web_chat", status: "waiting_human", sessionId: "chat_8c1f2a", details: { service_type: "AC service" } },
    customer,
  },
  "conversation.ended": {
    conversation: {
      id: "0b7c…",
      channel: "phone",
      status: "resolved",
      outcome: "ai_resolved",
      intent: "Book an AC service",
      handledBy: null,
      startedAt: "2026-10-03T04:28:40.000Z",
      endedAt: "2026-10-03T04:31:55.000Z",
      durationSeconds: 195,
      details: { address: "B-402, Palm Grove, Sector 70", service_type: "AC service" },
      sessionId: null,
    },
    customer,
  },
};

const fieldSchema = (fields?: Record<string, Field>) =>
  fields
    ? {
        type: "object",
        required: Object.entries(fields)
          .filter(([, f]) => f.required)
          .map(([k]) => k),
        properties: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { description: `${f.type} — ${f.description}` }])),
      }
    : undefined;

/** The same endpoints as an OpenAPI 3.1 document. */
export function openApiDocument(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    paths[e.path] ??= {};
    paths[e.path][e.method.toLowerCase()] = {
      tags: [e.group],
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
        ? { requestBody: { required: true, content: { "application/json": { schema: fieldSchema(e.request), example: e.example } } } }
        : {}),
      responses: {
        "200": { description: "OK", content: { "application/json": { example: e.response } } },
        "400": { description: "The request is wrong — `error` says how, in words you can show a user." },
        "401": { description: "Missing, invalid or revoked API key." },
        "402": { description: "The business's plan has no room for a new conversation. /health reports the feature as off." },
        "409": { description: "The chat has ended, or the card was already answered or replaced." },
        "422": { description: "A card can no longer be confirmed as it is — its date has passed, say." },
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
        "Connect a business's website and systems to its Corva AI assistant: chat, bookings and leads, visitors, voice, and webhooks back. Every call is made from your server with the business's API key.",
    },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "ck_… from Corva → Settings → Website & API keys" } } },
    paths,
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((e) => [
        e.type,
        {
          post: {
            summary: e.description,
            description:
              "POSTed to each webhook URL registered for it in Corva → Settings → Webhooks. Verify the `Corva-Signature` header: `t=<unix seconds>,v1=<hex HMAC-SHA256 of \"<t>.<raw body>\" with the webhook's secret>`. Answer 2xx within six seconds.",
            requestBody: {
              content: {
                "application/json": {
                  example: { id: "evt_3f9c0a1b2c3d4e5f6a7b8c9d", type: e.type, createdAt: "2026-10-03T04:31:13.000Z", data: WEBHOOK_EXAMPLES[e.type] },
                },
              },
            },
            responses: { "200": { description: "Received." } },
          },
        },
      ]),
    ),
  };
}
