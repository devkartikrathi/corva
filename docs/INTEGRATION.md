# Integrating a business's website and systems with Corva

For the developer a business hands its Corva key to. The full, always-current reference is the
live page **`/developers`** and the spec at **`/api/v1/openapi.json`** — both generated from
`lib/integrations/openapi.ts`. This document is the shape of an integration, the rules behind
the API that change what you build, and the standard we hold an integration to. It applies to
every business; the Tumble Days site (`../tumbledays`) is the worked example.

## The contract

- Two settings on the site's **server**: `CORVA_API_URL`, `CORVA_API_KEY` (`ck_…`, made in Corva →
  Settings → Website & API keys). The key never reaches the browser. That is the entire
  configuration; a payment endpoint or webhook receiver adds one signing secret each.
- The site owns its look: the chat window, the cards, the call screen. Corva owns the
  assistant, the knowledge, the bookings, the customer records, the team's work and the emails.
- Nothing about the business is hard-coded in the site. The assistant's name, the booking word
  and the fields come from `GET /config`.
- `v1` only grows. Expect new optional fields and new webhook event types, and ignore what you
  do not know.

## What the site builds

| Piece | Calls | Notes |
| --- | --- | --- |
| A chat route on its server | `POST /chat` (`stream: true`) | Adds the key and the visitor id; passes the event stream through. Its own per-IP rate limit in front. |
| A chat window | — | Shows `delta`s as they arrive; a typing indicator until the first one. |
| A booking / callback card | `POST /chat/confirm` | From `proposal`: `details`, plus `extra`. Confirm and Edit. Input locked until one is tapped. |
| Ending the chat | `POST /chat/end` | On `pagehide` (closing the tab, reloading) — `navigator.sendBeacon` to the site's own route, which calls Corva with the key. A `409` on the next message means start a new `sessionId`. |
| Takeover | `GET /chat` | Poll every ~8 s while a chat is open, ~3 s once `heldBy` is set. Show the person's name. |
| A voice button (optional) | `POST /voice-sessions` + WebSocket | Hidden unless `features.voice` (and `voiceSecure` on https). Push-to-talk. |
| Visitor tracking (optional) | `POST /visits` | A first-party visitor-id cookie; the consent the banner recorded. |
| Its own forms (optional) | `POST /leads` | Build the form from `fields`; send answers as `details`. |
| Order status (optional) | `POST /records` | From the business's own system, on every change: reference, a status sentence, the bill, expected times. The assistant answers "where is my order?" from it. |
| Payments (optional) | an endpoint Corva calls · `POST /payments` | The business's own payment account makes the link; Corva asks for it and hears back. See below. |
| A webhook receiver (optional) | — | Verifies `Corva-Signature`; idempotent on `id`. |
| Its own back office (optional) | `GET /leads`, `/customers`, `/conversations` · `POST /leads/{id}` | Reads use `lead.details` and `lead.request` as fields; work started or done there moves the lead here. |

## Rules behind the API

These are enforced in Corva's code, not in the assistant's prompt. They decide what your site
can rely on and what it has to handle.

### A chat has a beginning and an end

One `sessionId` is one chat. A conversation ends when:

1. the site calls `POST /chat/end` (the window closed, the page reloaded);
2. the same `visitorId` starts a new `sessionId`;
3. it has been quiet for 30 minutes (a voice call after 15, WhatsApp after 24 hours).

Ending closes it as *resolved* if the customer said anything (*abandoned* if not), records its
length, has it summarised and classified, and sends `conversation.ended`. After that the
`sessionId` answers `409` — start a new one. `POST /chat/end` on a chat that is already over, or
one Corva has never seen, returns `{ "ended": false }` and does nothing.

### One customer across every channel

Corva keeps one record per customer across website chat and voice, phone, WhatsApp, email,
`/records` and `/payments`. Every phone number and email they have used is kept on it, marked:

| | How Corva learnt it |
| --- | --- |
| **verified** | they wrote from it (WhatsApp, email), called from it, the business's system sent it (`/records`, `/payments`), a person on the team confirmed it, or they entered a code sent to it |
| **stated** | typed into a chat or a form (`/chat` `customer`, `/leads`) |

What this means for you:

- `customer` on `POST /chat` (a signed-in user's details, say) joins the chat to that customer,
  and the assistant will not ask for them again — but it is **stated**. The assistant only reads
  out what is on file (an address, past payments) and only takes a payment for a **verified**
  conversation. If your own login has already proven the number, that is still stated to Corva;
  the customer is asked for a code when it matters.
- A stated number or email never replaces the one on file, and two customers are never merged on
  a claim. A likely match goes to the team, who merge (and can undo a merge) on the customer's page.
- `GET /customers?phone=` / `?email=` match the number and email **on file**.
- A browser that was identified before (same `visitorId`) starts its next chat or call as that
  customer.

### Verification codes

When the assistant needs proof — before taking a payment, by default — it sends a 6-digit code to
the number (SMS, the business's DLT `otp` template) or email **already on the customer's record**,
never to one typed in the conversation. The customer types it into the chat as an ordinary
message. The model never sees the code; it is stored hashed, lasts 10 minutes and allows 5 tries.
Nothing to build on your side: your chat window only needs to pass the message through.

### The leads board

Five stages, the same for every business:

| `stage` | Board | Who moves it there |
| --- | --- | --- |
| `new` | New | the assistant, once the customer says who they are; a callback keeps it New |
| `contacted` | Contacted | a confirmed booking (on the card, or `POST /leads` with `kind: "booking"`), or a person who spoke to them |
| `proposal` | Processing | a person, or **your system** (`POST /leads/{id}`) — work under way |
| `won` | Converted | a payment reported `paid`, a person, or **your system** — done |
| `lost` | Lost | a person, or your system — never the assistant |

`qualified` is an older key: it is accepted on writes as `proposal`, and older leads may still be
returned with it — read it as Processing. `stageLabel` carries the board's word for the stage.
What happens *inside* Processing (a pickup, an appointment, a site visit) belongs in your system.

### Payments, offers and approvals

The money is the business's: its own payment account (Razorpay or any other) makes the link, and
no payment key ever reaches Corva. The business sets your endpoint in Corva → Settings → Payments
and is shown a signing secret (`cps_…`) once.

1. When someone asks for a payment, Corva `POST`s your endpoint, signed like a webhook:
   `requestId`, `orderReference` (or `amountRupees`, from a person only), `customer`,
   `conversationId`, `requestedBy`, `notify`, and `offer` when one applies.
2. Answer within 15 seconds with the payment as you made it, or `4xx` with `{ "error": "…" }` in
   words the customer may be told. The same `requestId` twice must return the same link.
3. Report every change to `POST /payments`. A status only ever climbs, so a late `expired` cannot
   undo a `paid`. `paid` thanks the customer where they asked and moves the lead to Converted.

What reaches your endpoint has already passed Corva's checks:

- **The assistant never names an amount.** It sends an order reference; you work out what is owed.
- **Offers are checked in code.** A business publishes its offers in Corva (code, % with a cap or
  a flat amount, minimum order, dates, first order only, once per customer, segments excluded).
  Corva sends `offer` only for a published offer that applies to this customer:
  `{ code, title, kind: "percent" | "flat", value, maxDiscountRupees?, minOrderRupees? }` —
  `value` is a percentage for `percent`, rupees for `flat`. Apply it to the amount you work out,
  or refuse if your order does not qualify. No `offer`, no discount.
- **Proof and approval.** By default the customer has proven who they are with a code, and a
  person on the team has approved the request (Settings → Payments, both on). So a request can
  arrive minutes after the customer asked, and `requestedBy` reads like
  `"Ava (AI), approved by Kavya Rao"`.

A business with no payment system can have Corva collect for it instead (switched on by Corva);
then there is no endpoint to build, only `POST /records` with `amountRupees` so the amount is known.
See [PAYMENTS.md](PAYMENTS.md).

### Order records

`POST /records` is how the assistant knows what happened after a booking. Send the order's state
under the reference the customer was given, on every change; the same `kind` + `reference`
replaces what was there. Write `status` as a sentence the customer can be told. Name the customer
by `customer.id`, `leadId` or `customer.phone` — a phone you send here counts as **verified** for
that customer. Never put an address or phone number in `meta`.

When a customer asks about a reference that is not among your records, the assistant goes on to
the business's own database if one is connected (see [DATA-SOURCES.md](DATA-SOURCES.md)). A lookup
by phone number only runs for the number the customer is verifiably writing from (WhatsApp); on a
website chat the assistant asks for the order reference instead.

### Webhooks

`lead.created`, `lead.updated`, `follow_up.created`, `handoff.requested`, `conversation.ended`,
each a signed `POST` (`Corva-Signature`) to the business's URL, delivered after the response with
one retry. Verify the signature, and treat a repeated `id` as already done. A test `ping` can be
sent from Settings.

## The reference implementation

In `../tumbledays`:

| File | What it shows |
| --- | --- |
| `src/lib/corva.ts` | The server-side client: JSON calls with one retry, and a raw call for streams |
| `src/app/api/chat/route.ts` | The chat proxy: validation, per-IP limit, visitor cookie, stream pass-through, takeover poll |
| `src/app/api/chat/confirm/route.ts` | Confirm / Edit |
| `src/app/api/chat/end/route.ts` | Ending a chat from `sendBeacon` (the body may arrive as plain text) |
| `src/components/chat/useCorvaChat.ts` | Reading the event stream, card state, takeover polling, ending on `pagehide` |
| `src/components/chat/ActionCard.tsx` | The confirmation card, including `extra` |
| `src/app/api/voice-token/route.ts`, `src/components/chat/VoiceCall.tsx` | A voice call, iPhone-safe, with a person taking over |
| `src/proxy.ts`, `src/lib/visitor.ts`, `src/app/api/visit/route.ts` | The visitor cookie and consent |
| `src/lib/admin/corva-push.ts` | Pushing order records to `POST /records` |
| `src/app/api/corva/payments/route.ts`, `src/lib/payments/` | The payment endpoint Corva calls: signature check, Razorpay Payment Links, reporting back to `POST /payments` |
| `src/app/api/corva/webhook/route.ts`, `src/lib/admin/corva-sync.ts` | A webhook receiver: signature check, idempotent on the event id, a confirmed booking becoming an order in the shop's own database |

It does not yet apply `offer` from a payment request.

## What we check before an integration goes live

1. The key is server-side only; `/health` is `ok` from production.
2. `/config` is read, not copied — rename a field in Corva and the site follows.
3. One `sessionId` per chat; `visitorId` on every call.
4. Closing or reloading the chat sends `/chat/end`; a `409` on the next message starts a new
   `sessionId` rather than showing an error.
5. A card that fails to confirm shows Corva's `error` (a `409` or `422` is a real answer).
6. A person taking over is visible in the chat within a few seconds.
7. The voice button only appears when a call can actually connect.
8. The site has its own rate limit: the business's 300 requests a minute are shared by all its
   visitors. One chat (`sessionId`) may send 12 messages a minute and 150 a day; past that the
   API answers 429.
9. Webhook deliveries are verified and safe to receive twice.
10. If the site takes payments: the endpoint verifies the signature, returns the same link for
    the same `requestId`, applies `offer` (or refuses), and every status change reaches
    `POST /payments`.
11. If the site sends records: references match what the customer was told, and `status` reads
    as a sentence.

## What changed for integrators

Newest first. Everything is backwards-compatible within `v1`.

| Date | Change | What to do |
| --- | --- | --- |
| 2026-10-03 | `POST /chat/end`. Chats also end when the same visitor starts a new chat, or after 30 quiet minutes (was: overnight). | Call it on `pagehide`; treat `409` on a message as "start a new `sessionId`". |
| 2026-10-03 | Leads board is five stages for every business: New, Contacted, Processing (`proposal`), Converted (`won`), Lost. `qualified` reads as Processing; `stageLabel` is the board's word, no longer per business. A `paid` payment converts the lead. | Map stages by key, not by label; treat `qualified` as `proposal`. |
| 2026-10-03 | Payment requests carry `offer` when a published offer applies. By default the customer is verified by code and a person approves before your endpoint is called. | Apply `offer`, or refuse the request. Expect `requestedBy` to name the approver. |
| 2026-10-03 | One customer across every channel; numbers and emails are verified or stated. `customer` on `/chat` is stated. `/records` and `/payments` phones are verified. | Nothing required. Do not expect a signed-in user's number to unlock record details without a code. |
| 2026-10-03 | Order lookups fall through to the business's connected database; phone-number lookups only for a verified sender. | Nothing required. |
| 2026-10-03 | `POST /payments`, `GET /payments`; the payment endpoint. | Optional: see "Payments, offers and approvals". |
| 2026-10-02 | `POST /records`, `GET /records`. | Optional: send order status. |

## Changing the API (for Corva's developers)

- `v1` only grows: new optional fields, new event types. Never rename or remove within `v1`.
- Describe the change in `lib/integrations/openapi.ts` in the same commit — the docs and spec
  are that file — and add a row to "What changed for integrators" above.
- Examples stay business-neutral ("Acme Home Services", assistant "Ava").
