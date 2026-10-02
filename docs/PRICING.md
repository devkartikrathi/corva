# Pricing

The plans (`lib/billing/plans.ts` — the public site, Billing, Razorpay and the limits all read
that one file), why they are shaped this way, how they are enforced, and what is still missing.

## The model

A monthly plan with usage included, and a price for going over. Not pure per-conversation
pricing, which is what the site carried before:

- A small business wants to know its bill. "₹36 a conversation" makes a good month expensive
  and makes the owner want *fewer* customers to reach the assistant.
- Chat and voice cost us very different amounts, so one per-conversation price either
  overcharges chat or loses money on calls.
- The value is the whole front office — the assistant, the CRM, the team's follow-ups — not a
  count of messages.

| | Starter | Growth | Business |
| --- | --- | --- | --- |
| **Per month** (excl. GST) | **₹2,999** | **₹8,999** | Talk to us |
| AI chat conversations included | 500 | 2,500 | Custom |
| AI voice minutes included | 150 | 800 | Custom |
| Businesses (brands) | 1 | 3 | Unlimited |
| Team members | 3 | 15 | Unlimited |
| Website chat and voice | ✓ | ✓ | ✓ |
| Leads, follow-ups, customer records | ✓ | ✓ | ✓ |
| Details to collect, bookings by card | ✓ | ✓ | ✓ |
| API and webhooks | ✓ | ✓ | ✓ |
| Take over chats and calls live | ✓ | ✓ | ✓ |
| Team performance, roles, audit log | — | ✓ | ✓ |
| Conversation history kept | 90 days | 2 years | Custom |
| Own phone numbers, custom industry setup, SSO, SLA | — | — | ✓ |
| **Beyond the included usage** | ₹5 / chat · ₹6 / voice minute | ₹4 / chat · ₹5 / voice minute | Custom |

A **chat** is one conversation the assistant took part in, however many messages. A **voice
minute** is a minute a call is connected, whoever is speaking. Conversations an owner runs from
*Try it* are free.

Every business starts on a **pilot**: 14 days, 100 chats, 30 voice minutes, one brand, five team
members, every feature, no card.

## What it costs us to serve

Measured on real conversations in production (the console's *cost to serve*, computed in
`lib/pricing.ts` from provider rates):

| | Roughly |
| --- | --- |
| A chat conversation on Gemini 3.5 Flash Lite — about 2 paise an exchange, retrieval included | ₹0.05 – ₹0.25 |
| A voice minute on Gemini Live — an 85-second call measured ₹2.51 | ₹1.50 – ₹2.50 |
| Infrastructure per business (Vercel, Neon, Clerk, Resend at low volume) | small, shared |

So the included usage in Starter costs about ₹500 at the very most, and an overage voice minute
at ₹6 covers its cost more than twice. A real telephone line (not built — see below) adds a
carrier's per-minute charge on top, which is why voice overage is priced with room.

The console shows **cost to serve** on every conversation (Conversations → detail), which is the
figure to watch if these prices change.

## How it is enforced

| | |
| --- | --- |
| **Usage** | Read from the conversations themselves for the current period (`lib/billing/usage.ts`) — no separate counter to drift. Shown on **Billing** and in `/admin`. |
| **A pilot's allowance** | Hard: once the chats (or voice minutes) are used, new chats (or calls) are refused until a plan is chosen. |
| **A paid plan's allowance** | Soft: the assistant keeps answering, and the overage is added to the next payment at the plan's rates. |
| **A period ending** | Three days of grace, then the assistant stops taking new conversations. The console says so on every screen from three days before. |
| **Mid-conversation** | Never cut off. Limits are checked when a chat or call starts. The API answers `402` with a message that is safe to show a customer; `/health` and `/config` report the feature as off so a site can hide the button. |
| **Team and brand limits** | Checked when someone is invited or a brand is added. |
| **Team performance, audit log** | Growth and above (and the pilot). |
| **History** | Conversations older than the plan's window are not listed. Nothing is deleted. |

## How it is paid

Razorpay Checkout, one month at a time, from **Billing** — the same integration as in myfin
(`lib/billing/razorpay.ts`, `app/api/razorpay/*`):

1. The browser asks for an order for a *plan*. The server works out the amount — the plan, plus
   any overage owed on the period being closed, plus 18% GST — and stamps the business and the
   breakdown into the order.
2. Checkout takes the payment. What the browser reports back is believed only once its
   signature verifies against the key secret; then the business is on the plan for 30 days from
   that moment, and its usage starts again from zero.
3. Razorpay's webhook reports the same payment and grants the plan if step 2 never happened
   (a closed tab). Whichever arrives second does nothing. A refund or lost dispute ends the
   period at once.

There is no automatic renewal: a business renews from Billing, which offers it in the last
seven days of a period. `/admin` can put any business on any plan for any number of days — for
a longer pilot, a bank transfer, or Business.

## What is still missing

- **Tax invoices.** Billing shows receipts with the GST amount; it does not issue a GST invoice
  with Tiruvi's GSTIN and the customer's.
- **Automatic renewal.** Razorpay Subscriptions (a mandate) instead of a payment each month.
- **Proration.** Moving up a plan mid-month starts a fresh month at the full price.
- **Deleting old history.** The window hides conversations; a retention job would remove them.
- **Real phone numbers.** Voice is the website's call button; a telephone line adds a carrier's
  per-minute cost on top of the figures above.
