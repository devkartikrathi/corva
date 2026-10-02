# Pricing

The plans on the public site (`lib/marketing.ts`), why they are shaped this way, and — plainly —
what is not built yet.

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
| Website chat, voice button, phone line | ✓ | ✓ | ✓ |
| Leads, follow-ups, customer records | ✓ | ✓ | ✓ |
| Details to collect, bookings by card | ✓ | ✓ | ✓ |
| API and webhooks | ✓ | ✓ | ✓ |
| Take over chats and calls live | ✓ | ✓ | ✓ |
| Team performance, roles, audit log | — | ✓ | ✓ |
| Conversation history kept | 90 days | 2 years | Custom |
| Own phone numbers, custom industry setup, SSO, SLA | — | — | ✓ |
| **Beyond the included usage** | ₹5 / chat · ₹6 / voice minute | ₹4 / chat · ₹5 / voice minute | Custom |

A **conversation** is one chat session or one call, however many messages. A **voice minute** is
a minute a call is connected, whoever is speaking. Setup is done with the business and is free;
a new business gets a 14-day pilot before the first invoice.

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

## What is not built

Said plainly, because the public site shows the plans:

- **Nothing is metered against a plan.** Usage is measured per conversation, but there is no
  plan on an organization, no included-usage counter, and no overage calculation.
- **No billing.** No invoices, no payment collection, no GST handling.
- **No plan gates.** Team performance, roles and the audit log are available to every business
  today; the brand and team-member limits are not enforced.
- **Retention is not enforced.** Nothing is deleted at 90 days or two years.
- **Real phone numbers** are not connected. A business's "number" today is a Corva test line
  reached from the dialer; calls from the public come through the website's voice button.

Until those exist, a business is invoiced by hand from its usage. The order to build them in is
in [ROADMAP.md](ROADMAP.md).
