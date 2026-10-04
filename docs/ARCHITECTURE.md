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
rules, what is known about the customer (one line of their profile, their last payments, and
whether the conversation is **verified**), the retrieved sources, an outline of the business's
**Products & services**, the **Details to collect** (with what is still missing), the published
**offers**, the payment rules, and — in a web chat — the booking instructions. A reply that opens
by thinking aloud ("The customer is asking…") is not streamed; only its answer is sent.

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

## Embeddings, at the provider's pace

`lib/knowledge/index.ts`. Gemini's free tier allows 100 embeddings in any rolling minute, and
every customer question spends one. So saving knowledge (a document, a catalog edit, a website
import) draws on a shared allowance counted in `rate_limits` — `EMBEDDINGS_PER_MINUTE`, default
60, handed out in ten-second slices so a rolling minute never holds more than 70. What fits is
embedded on save; the rest is stored without a vector and `embedPending` finishes it:

- right after the save responds (`after()`), for up to about four minutes;
- when Products & services is opened while lines are still waiting (it shows the progress);
- on the daily job (`/api/cron/daily`), and from `npm run db:embed`.

Until a chunk has its vector, retrieval matches it by its words alongside the vector search,
so a long price list is answerable the moment it is saved.

### Tools

Text turns (website chat, WhatsApp, email, the console's tester) and voice offer the same
tools; a tool is only offered when the business has what it needs (a payment route, a database,
published offers).

| Tool | Where | What it does |
| --- | --- | --- |
| `record_details` | web chat | Stores answers to the business's Details to collect |
| `propose_booking`, `propose_callback` | web chat | Validates the details and returns a card for the customer to confirm |
| `save_caller_details` | voice, console | Creates or updates the lead (and the business's own fields) |
| `schedule_follow_up` | all | A task for a named person with a due time |
| `take_action` | all | An account action, allowed or refused by the authority table |
| `close_with_agreement` | all | The customer accepted a no; leaves a row for a person to confirm |
| `look_up_record` | all | An order by its reference, from what the business pushed (`POST /records`); "not found" sends the assistant on to `look_up_data` |
| `look_up_data` | all, with a connected database | One of the business's approved read-only lookups (`lib/data/sources.ts`); a phone-number parameter only runs for the verified sender's own number |
| `email_details` | all | Emails an order's full details to the address **on file** for its customer, never one given in the conversation |
| `check_offer` | all, with published offers | Whether a code applies to this customer — dates, segment, first order, once each — decided in code (`lib/payments/offers.ts`) |
| `request_payment` | all, when the business can collect | An order's payment link, by reference only; may wait for a person's approval, or ask for verification first |
| `send_verification_code`, `verify_code` | all | A code to the number or email on file; checking what the customer typed (`lib/verify/codes.ts`) |
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

## Who the customer is

`lib/crm/identity.ts`. A customer is found by a **handle** — a phone number or email — in
`customer_identities`. Each handle is **verified** (a WhatsApp sender, a real caller id, the
address an email came from, the business's system via `/records` or `/payments`, a person on the
team, a code) or **stated** (typed into a chat or a form). Every way in — callers, WhatsApp,
inbound email, the records API, saved details, the transcript read after a call — goes through
`customerForHandle` / `keepHandle`.

- A conversation carries `identified_by`; `isVerified()` decides whether the assistant may read
  out record details (an address, payments) and take payment.
- A stated handle never becomes the number or email on file. A record a conversation made a
  moment ago (a name-only stand-in) folds into the customer it turned out to be; two real
  customers are never merged on a claim — `recordMatch` leaves a `customer_matches` row for the team.
- `mergeCustomers` moves everything in one statement batch and records exactly what moved
  (`customer_merges.moved`); `undoMerge` recreates the folded-in record with its own id, puts back
  what was its, and marks the two as different people. `removeHandle` takes a number or email off
  a record; the next person to use it is a new customer.
- A browser that was identified before (`visitors.customer_id`) starts its next chat or web call
  as that customer (`identified_by = 'browser'`, not verified).

`lib/crm/profile.ts` computes `customers.profile` — contacts by channel, orders and their usual
gap, value, trend, issues, short stays, a segment per kind of business — on identification,
merges, records, payments, when the assistant reads a stale one, and nightly. It feeds the
priority engine as weighted signals. See [CUSTOMER-PROFILES.md](CUSTOMER-PROFILES.md).

## When a conversation ends

`lib/conversations/ending.ts`. A call hangs up; the other channels do not, so a conversation ends:

- when the site says so (`POST /api/v1/chat/end`);
- when the same browser starts a new chat (`endEarlierChats`);
- after it has been quiet for 30 minutes (web chat), 15 (a call) or 24 hours (WhatsApp — its
  reply window). `endQuietConversations` runs on any console page load, at most once a minute,
  and on the daily job.

`endConversation` gives each one a call's close: resolved if the customer said anything, else
abandoned; its end time and length; uncontained if a person stepped in; then the classifier's
summary, intent and outcome, and `conversation.ended` to webhooks. Email threads are never left
live.

## Payments, offers and verification

`lib/payments/`. The money is the business's: Corva asks the business's endpoint for a link (a
signed POST, `askForPayment`) and hears back on `POST /api/v1/payments` (`recordPayment`); a
business with no system can have Corva collect on its own Razorpay account (`hosted.ts`).
Statuses only climb, and `paid` moves the lead to Converted.

- **The assistant never names an amount**: `askForPayment` refuses one from it.
- **Approval** (`approvals.ts`, `payment_policies`): on by default. The assistant's request
  becomes a `payment_approvals` row on the Handoffs screen; *Approve & send* makes the link and
  posts it where the conversation is.
- **Verify first**: on by default. `request_payment` on an unverified conversation returns
  `needsVerification`, and the assistant sends a code.
- **Offers** (`offers.ts`; `offers`, `offer_uses`): the only discounts. `checkOffer` decides in
  code; an applied offer travels on the approval and the request and is applied by the business's
  system (or by `hosted.ts`). One use per customer is recorded.
- **Codes** (`lib/verify/codes.ts`, `verification_codes`): six digits by SMS (the `otp`
  template; never written to the SMS log) or email, only to a handle on file; HMAC-hashed under
  `DATA_SOURCE_KEY`, 10 minutes, 5 tries, 3 per conversation an hour and 6 per handle a day. A
  right code sets `identified_by = 'otp'` and verifies the handle.

See [PAYMENTS.md](PAYMENTS.md) and [PAYMENTS-AND-VERIFICATION.md](PAYMENTS-AND-VERIFICATION.md).

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
| Assistant | `agent_versions` (+ `authority_limits`, `escalation_triggers`, `never_rules`), `intake_fields`, `documents`, `document_chunks`, `catalog_categories`, `catalog_items` |
| Conversations | `conversations` (+ `identified_by`, `visitor_id`), `turns`, `turn_citations`, `conversation_actions`, `handoffs`, `chat_proposals` |
| CRM | `customers` (+ `profile`), `customer_identities`, `customer_matches`, `customer_merges`, `leads`, `follow_ups`, `customer_notes`, `customer_scores`, `customer_records` |
| Customer payments | `payment_endpoints`, `customer_payments`, `payment_policies`, `payment_approvals`, `offers`, `offer_uses`, `collection_settings` |
| Verification and SMS | `verification_codes`, `sms_settings`, `sms_templates`, `sms_messages` |
| Channels | `email_inboxes`, `email_messages`, `whatsapp_numbers`, `whatsapp_seen` |
| Integrations | `api_keys`, `webhooks`, `visitors`, `visitor_events`, `channels`, `data_sources`, `data_lookups` |

## Channels beyond the website

Every channel ends in the same place: a row in `conversations` with a `channel`, on a customer.

| Channel | How it arrives | Who answers | Code |
|---|---|---|---|
| Website chat | The business's server calls `POST /chat` | The assistant; a person on takeover | `lib/integrations/intake.ts` |
| Website voice | The browser opens a WebSocket with a signed token | The assistant; a person on takeover | `lib/voice/*` |
| WhatsApp | Meta's webhook, verified by the business's app secret | The assistant, through the same `agentChat`; a person's reply is pushed to WhatsApp | `lib/whatsapp/cloud.ts` |
| Email | Forwarded to the business's Corva address, received through Resend's webhook the moment it arrives | The assistant (a switch on the Email screen), except on threads a person has replied on or that need the team; the team from Corva. Replies return to the same thread | `lib/email/inbound.ts` |

A business's own database is not a channel but a source: lookups it approves become one tool
for the assistant (`lib/data/sources.ts`), run read-only.

What a business connects (database, inbox, WhatsApp token) is sealed with `DATA_SOURCE_KEY`
(`lib/data/crypto.ts`) and never sent to a browser.

## Limits and outbound safety

- `lib/rate-limit.ts` counts in Postgres, one row per key per window, so a limit holds across
  server instances. It fails open: if the database cannot be reached the call is allowed.
- `lib/net.ts` resolves a host and refuses private addresses before Corva connects to anything
  a business typed in; `fetchPublic` re-checks on each redirect.
- `/api/cron/daily` is the one scheduled job (once a day, `vercel.json`): it closes any quiet
  conversation the console has not closed already, refreshes customer profiles, sweeps old
  counters and receipts, and finishes knowledge still waiting for vectors. Nothing
  customer-facing waits on it.

Schema changes go through `npm run db:generate` (a migration in `drizzle/`) and
`npm run db:migrate`. Additive migrations are applied before the code that needs them ships.
