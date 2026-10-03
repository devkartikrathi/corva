# How Corva fits together

One Next.js app (App Router) on Vercel, one Postgres database (Neon, with pgvector), Gemini for
language and voice, Clerk for sign-in, Resend for email. No second server: the voice bridge is a
WebSocket route inside the app.

```
 customer's browser ──► business's website ──(API key, server-side)──► Corva /api/v1/*
        │                                                                   │
        └── voice: WebSocket ───────────────────────────────────────► Corva /api/voice ──► Gemini Live
                                                                            │
 business's team ──(Clerk sign-in)──► Corva /app ──────────────────────────┤
                                                                            ▼
 business's systems ◄──(signed webhooks)──────────────────────────── Postgres (Neon)
```

## Tenancy

`organizations` → `brands` → everything else. A **brand** is one business as its customers know
it: its assistant, knowledge, number, customers, leads. An organization can hold several brands
(branches, or separate trading names) with one team. Every table that holds business data
carries `brand_id`, and every read and write is scoped by it:

- the console resolves the brand from the signed-in membership (`lib/auth/context.ts`);
- the API resolves it from the key (`brandForRequest`, `lib/integrations/keys.ts`) — a key is
  one brand, stored only as a SHA-256 hash;
- the voice bridge resolves it from a signed token (website calls) or the dialled number.

Nothing a client sends chooses the brand.

## One turn of the assistant

`lib/agent/respond.ts` — `respondStream()` is the pipeline, `respond()` waits for it.

1. **Record** the customer's message, with a lexicon sentiment score (needed before generation,
   so it is not a model call).
2. **Retrieve** from the brand's published documents: embedding search in pgvector, word
   matching when embeddings are unavailable (`lib/agent/retrieval.ts`). No match above the
   confidence floor is logged as a knowledge gap.
3. **Check the triggers** (`lib/agent/guardrails.ts`): repeated requests for a person, falling
   sentiment, a high-priority customer, nothing to answer from. A fired trigger pre-empts
   generation — the assistant says a holding line and a handoff is written.
4. **Generate**, with tools. Every action goes through the authority table
   (`lib/agent/authority.ts`): the model is not told the ceilings, it asks and is told yes or
   no. A refusal mid-turn is itself a trigger.
5. **Persist** the reply with its citations, bill the conversation, update the one-line summary.

The system prompt is assembled per turn from the brand's persona, the authority and never
rules, what is known about the customer, the retrieved sources, an outline of the business's
**Products & services**, the **Details to collect** (with what is still missing), and — in a
web chat — the booking instructions.

## Products & services

`lib/catalog/index.ts`. Two tables: `catalog_categories` (groups, nested to any depth through
`parent_id`) and `catalog_items` (kind service/product, name, `price_paise` — null means "on
request" — a free-text `price_unit` such as "per kg", a description, and an `available` switch).
Nothing about them is industry-specific: a laundromat's *Dry cleaning › Men's wear › Shirt*
and a clinic's *Dermatology › Consultation* are the same rows.

The assistant reaches the catalog two ways, and no channel has its own path:

- **In the prompt.** `loadAgentConfig` puts `catalogOutline()` on `config.catalog`, so chat,
  voice and the Try-it preview all carry it. It degrades to fit (descriptions, then prices,
  then group names only) rather than being cut off.
- **In retrieval.** Every edit rewrites one published knowledge document (`source_system =
  'corva:catalog'`, titled *Products & services*) with one chunk per item, one per group and
  an overview, so answers are found and cited like any other document. Unchanged chunks keep
  their embeddings, and the chunk swap is one transaction behind a per-document lock. The
  document is read-only on the Knowledge screen; the rows are the truth.

### Tools

| Tool | Where | What it does |
| --- | --- | --- |
| `record_details` | web chat | Stores answers to the business's Details to collect |
| `propose_booking`, `propose_callback` | web chat | Validates the details and returns a card for the customer to confirm |
| `save_caller_details` | voice, console | Creates or updates the lead (and the business's own fields) |
| `schedule_follow_up` | all | A task for a named person with a due time |
| `take_action` | all | An account action, allowed or refused by the authority table |
| `close_with_agreement` | all | The customer accepted a no; leaves a row for a person to confirm |
| `search_knowledge`, `escalate_to_human` | voice | Retrieval and handoff, as tools, because Live has no pre-turn hook |

### Why bookings are proposals

In a web chat the assistant never books. `propose_*` writes a row in `chat_proposals` and the
API returns it; the site shows a card; `POST /chat/confirm` re-validates and only then runs
`intakeLead` (customer, lead, owner, follow-up, emails). A mistyped date becomes an Edit, not a
promise the team has to unpick. On a phone call there is no card, so the lead is written as the
call goes.

## Details to collect

`intake_fields` is the brand's list (`lib/business/intake.ts`); defaults come from the industry
template the first time they are read. Answers are stored as `{ key: value }` on
`conversations.captured` (so whoever takes the line sees them) and `leads.details` (so whoever
follows up does). Name, phone, email and address also fill the customer record's own columns
when those are empty — never overwriting.

The same list is exposed at `GET /api/v1/config`, accepted as `details` on `POST /api/v1/leads`,
returned as `details` on every chat reply, and included in webhook payloads.

Because answers are stored by key in a JSON column, a field a business adds today needs no
schema change and is immediately filterable: `GET /api/v1/leads?details.<key>=<value>`
(`lib/integrations/read.ts`). A booking's own fields — date, time slot, services, address,
reference — are kept the same way in `leads.request`, so nothing has to be parsed out of the
human-readable `interest` line.

## Voice

`lib/voice/bridge.ts` is one call: browser ⇄ bridge ⇄ Gemini Live. On Vercel it runs in
`app/api/voice/route.ts` (WebSocket upgrade on Fluid Compute); locally `npm run voice` runs the
same code.

- **Push-to-talk, signalled explicitly.** The bridge tells the model when the caller starts and
  stops (`activityStart` / `activityEnd`); the model's own speech detection is switched off.
  The first audio frame after a pause starts a turn, `end_turn` (or 1.5 s of no audio) ends it.
- **Same rules as text.** Retrieval and actions are tools; authority is enforced in the tool
  handler; turns are persisted from Live's own transcription.
- **Limits enforced by the bridge**, not the browser: a session cap, an idle timeout, a
  concurrency cap per instance.

### A person on the call

Taking the line is a row change (`conversations.handled_by`) made by the console. The bridge
polls for it once a second and then:

1. lets the model finish what it was saying, unheard, and has it say one sentence handing over
   — capped to that sentence;
2. mutes the model (its audio is dropped, its tools refused) but keeps feeding it the caller's
   audio, which is what keeps the caller transcribed;
3. opens the **relay** (`lib/voice/relay.ts`): the caller's socket and the person's socket are
   usually on different function instances, so audio between them goes through Postgres
   `LISTEN/NOTIFY` on a channel per conversation, batched one round trip at a time.

The person's side is `components/CallRoom.tsx` → `lib/voice/agent.ts`: hold-to-talk, the
caller's voice through their speakers, their own words transcribed by the browser and written
as `human` turns. Handing back gives the model a note of what was said.

## Models

`lib/agent/models.ts` is the catalogue; `lib/agent/model.ts` is the only file that knows the
provider. Website chat uses `CHAT_MODEL_ID` (Flash Lite); other text work uses the brand's
model; voice uses a Live model. Streams are **hedged**: if the first model has not started
answering within `MODEL_HEDGE_MS`, the next is asked as well and the first to answer wins —
Gemini's time-to-first-token swings from under a second to twenty within an hour.

## Events out

`lib/integrations/webhooks.ts`. `emit(brandId, type, payload)` is called where the thing
happens (a lead saved, a follow-up scheduled, a brief written, a conversation closed), never
awaited, and delivered after the response with one retry. Each delivery is signed with the
webhook's own secret; the last result is stored on the webhook.

## Plans and payment

`lib/billing/plans.ts` is the catalogue; `organizations.tier`, `period_start` and `period_end`
are a business's place in it. `accountState()` (`lib/billing/usage.ts`) derives everything else
on demand — usage from the period's conversations, overage, whether the period is active, in
grace or lapsed — so there is no counter to keep in step. `blocked()` is asked when a chat or a
call starts; the team and brand limits are asked where those are created.

Payment is Razorpay Checkout (`app/api/razorpay/order|verify|webhook`). The order is priced on
the server and carries the business and tier in its notes; `payments` is keyed on the Razorpay
payment id and `grantPlan()` flips `granted` once, so the browser's verified report and the
webhook can both arrive without doing anything twice.

## Sign-in and roles

Clerk proves who someone is; Postgres decides what they may do. `memberships` holds role and
brand scope; `lib/auth/permissions.ts` is the capability matrix; `guardScreen()` gates pages and
`assertCan()` gates actions. A verified email claims a waiting membership on first sign-in;
someone signed in with no membership is sent to `/welcome` to set a business up
(`lib/actions/welcome.ts`).

Corva's own back office, `/admin`, is not a role in any business: `requireAdmin()`
(`lib/admin/auth.ts`) allows the verified emails in `CORVA_ADMIN_EMAILS` and answers 404 to
everyone else. It reads plans, usage and payments — never a business's conversations.

## Data model, briefly

| Area | Tables |
| --- | --- |
| Tenancy and people | `organizations`, `brands`, `memberships`, `audit_log` |
| Billing | `organizations.tier` / `period_*`, `payments`, `demo_requests` |
| Assistant | `agent_versions` (+ `authority_limits`, `escalation_triggers`, `never_rules`), `intake_fields`, `documents`, `document_chunks` |
| Conversations | `conversations`, `turns`, `turn_citations`, `conversation_actions`, `handoffs`, `chat_proposals` |
| CRM | `customers`, `leads`, `follow_ups`, `customer_notes`, `customer_scores` |
| Integrations | `api_keys`, `webhooks`, `visitors`, `visitor_events`, `channels` |

## Channels beyond the website

Every channel ends in the same place: a row in `conversations` with a `channel`, on a customer.

| Channel | How it arrives | Who answers | Code |
|---|---|---|---|
| Website chat | The business's server calls `POST /chat` | The assistant; a person on takeover | `lib/integrations/intake.ts` |
| Website voice | The browser opens a WebSocket with a signed token | The assistant; a person on takeover | `lib/voice/*` |
| WhatsApp | Meta's webhook, verified by the business's app secret | The assistant, through the same `agentChat`; a person's reply is pushed to WhatsApp | `lib/whatsapp/cloud.ts` |
| Email | Read from the business's inbox over IMAP, on a schedule | Nobody in Corva: the business replies from its mail app and the reply is read back | `lib/email/mailbox.ts` |

A business's own database is not a channel but a source: lookups it approves become one tool
for the assistant (`lib/data/sources.ts`), run read-only.

What a business connects (database, inbox, WhatsApp token) is sealed with `DATA_SOURCE_KEY`
(`lib/data/crypto.ts`) and never sent to a browser.

## Limits and outbound safety

- `lib/rate-limit.ts` counts in Postgres, one row per key per window, so a limit holds across
  server instances. It fails open: if the database cannot be reached the call is allowed.
- `lib/net.ts` resolves a host and refuses private addresses before Corva connects to anything
  a business typed in; `fetchPublic` re-checks on each redirect.
- `/api/cron/inbox` is the one scheduled job: it reads inboxes that are due and sweeps old
  rate-limit windows and WhatsApp receipts.

Schema changes go through `npm run db:generate` (a migration in `drizzle/`) and
`npm run db:migrate`. Additive migrations are applied before the code that needs them ships.
