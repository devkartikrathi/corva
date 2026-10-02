# Corva

An AI front office with customer and team management, for small and mid-sized businesses in
India. It is for any kind of business: it manages customers and the people serving them, not
orders or jobs, which stay in the business's own system.

Each business gets an AI assistant that answers its **website chat**, **voice calls from its
website** and its own **WhatsApp number** — from the business's own knowledge, inside limits
the business sets. (A real telephone number is next; see the roadmap.) Customers who write
to its **email** are read from its inbox onto the same records. Every conversation becomes work the team can act
on: a **customer** record, a **lead** with an owner, a **follow-up** with a name and a time. The team works those from one
console, can **take any chat or call over live**, and the owner can see who is winning leads
and keeping promises.

Three things in one product, on purpose:

| | What it is | Who uses it |
| --- | --- | --- |
| **AI assistant** | Chat and voice, grounded in the business's documents, with bookings the customer confirms | The business's customers |
| **Customer management** | Customers on every channel, leads in the business's own pipeline words, follow-ups, the details the business chose to collect | The business's team |
| **Team management** | People and roles, attendance, who answered what, performance per person, an audit log | The business's owner and managers |

A business signs itself up (`/sign-up` → `/welcome`), gets a working assistant from its website
in a couple of minutes on a free 14-day pilot, and then connects its site:

1. **Chat on its website** — its chat window talks to Corva's assistant (`/developers`).
2. **Voice on its website** — a call button; the team can take the call over and talk.
3. **Its own assistant or forms** — it keeps what it has and sends Corva the results.

With no developer at all it can also connect its **WhatsApp number**, its **email inbox** and
its own **database** from the console.

Tumble Days (a laundry in Gurugram, `../tumbledays`) is the first business live on it and the
reference integration. Nothing in Corva is specific to it: every business has its own
knowledge, assistant name, pipeline words, details to collect and booking word.

Built for India: every figure is rupees, stored as paise and printed with Indian grouping
(₹12,49,500). `lib/money.ts` is the only place that decides how money reads.

## Run it

```bash
cp .env.example .env.local     # database, Gemini key, Clerk keys — see the file
npm install
npm run db:migrate             # schema, on a fresh database
npm run dev                    # http://localhost:3000
npm run voice                  # the voice bridge, for calls (ws://localhost:8787)
```

- `/` — the public site · `/demo` — the demo request form · `/developers` — API docs
- `/sign-up` → `/welcome` — a business setting itself up · `/app` — its console
- `/admin` — Corva's own back office: every business, plans, payments, demo requests. Only
  for the emails in `CORVA_ADMIN_EMAILS`.
- `/api/status` — which pieces are configured (never a secret's value).

## Documentation

| Read | For |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit: the turn pipeline, voice, handover, tenancy, where things live |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | Bringing a new business on, step by step — ours and theirs |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | What a business's developer builds; the checklist we hold an integration to |
| `/developers` (live) | The API reference, generated from `lib/integrations/openapi.ts`; also `/api/v1/openapi.json` |
| [docs/TEAM-AND-CHANNELS.md](docs/TEAM-AND-CHANNELS.md) | The overview, attendance, the email inbox and WhatsApp |
| [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) | Connecting a business's own database: approved lookups for customers, questions for the team |
| [docs/PRICING.md](docs/PRICING.md) | The plans, what they cost us to serve, how they are enforced and paid for |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What businesses will need next, in the order we think they will ask |
| [DEPLOYING.md](DEPLOYING.md) | Putting Corva on Vercel, and connecting a business's site |
| [docs/VOICE.md](docs/VOICE.md) | Voice measurements, protocol notes and gotchas |
| [.env.example](.env.example) | Every environment variable, with notes |

## A business's console — `/app/*`

| Group | Route | Screen |
| --- | --- | --- |
| Operate | `/app` | Home — follow-ups due, newest leads, live conversations, who needs a person |
| | `/app/live` | Live — transcript, details collected, **take the line** (chat or voice), hand back |
| | `/app/handoffs` | Handoffs the AI raised, each with the brief it wrote |
| | `/app/conversations` | Every conversation, with what each answer was based on |
| | `/app/email` | **Email** — connect the inbox; customer threads, and which still await a reply |
| | `/app/whatsapp` | **WhatsApp** — connect the business's own number; its conversations |
| Sales | `/app/leads` | The pipeline, in the business's own stage names, with collected details on each card |
| | `/app/follow-ups` | Callbacks and promises — overdue, today, upcoming, done |
| | `/app/customers` | Customers and each one's record: leads, follow-ups, conversations, website visits |
| AI assistant | `/app/try` | **Try it** — chat to or ring your own assistant as a customer; free, and kept out of the numbers |
| | `/app/knowledge` | What the AI may answer from; gaps it found |
| | `/app/tuning` | Persona, tone, what it may do alone, when it hands over — drafted, then published |
| | `/app/details` | **Details to collect** — the fields the AI asks every customer for |
| | `/app/data` | **Your database** — connect it; the lookups the AI may run for customers; ask it anything |
| | `/app/analytics` | Containment and what the AI still cannot finish |
| Team | `/app/overview` | **Overview** — customers by channel, who answered (AI or people) day by day, each person's work |
| | `/app/attendance` | **Attendance** — start and end your day; the week as a grid; a manager records leave |
| | `/app/performance` | Per person: leads owned and won, follow-ups on time, handoffs |
| | `/app/team` | People, roles and invitations |
| | `/app/setup` | Settings — channels, hours, **API keys**, **webhooks**, privacy, audit log |
| | `/app/billing` | **Billing** — the plan, usage against what it includes, overage, pay or renew, receipts |

Roles are Owner, Admin, Manager, Agent and Analyst (`lib/auth/permissions.ts`). An Agent sees
their own leads, follow-ups and customers; a Manager or Owner sees the whole business. Every
screen and every action re-checks the capability on the server.

Sign-in is Clerk; roles and memberships live in Postgres. Signing in with a *verified* email
claims whatever is waiting for it — an invitation or the Owner seat created at onboarding
(`claimByEmail`, `lib/auth/session.ts`).

## Plans, usage and payment

`lib/billing/plans.ts` is the one catalogue: the public pricing, what Razorpay is asked to
collect and what the product enforces all read it.

- Every business starts on a **pilot**: 14 days, 100 chats, 30 voice minutes, no card.
- **Usage** is read from the conversations themselves for the current period
  (`lib/billing/usage.ts`). Conversations from *Try it* are free.
- **Limits** are checked where a thing starts: a new chat or call (`402` from the API once a
  pilot is used up or a plan has lapsed — never mid-conversation), an invitation (team size),
  a new brand. Paid plans do not stop at their allowance: the overage is added to the next
  payment. Team performance and the audit log come with Growth; history is readable for the
  plan's window.
- **Payment** is Razorpay Checkout, a month at a time (`app/api/razorpay/*`,
  `lib/billing/razorpay.ts`, `lib/billing/payments.ts`): the server prices the order, the
  signature is verified before a plan changes, and Razorpay's webhook grants the plan when
  the tab was closed. There is no automatic renewal.

## Corva's back office — `/admin/*`

For the people who run Corva — an allowlist of verified emails (`CORVA_ADMIN_EMAILS`), not a
role inside any business. It works on the live site.

| Route | Screen |
| --- | --- |
| `/admin` | Every business: plan, when it ends, usage, leads, last conversation, what it has paid |
| `/admin/businesses/[slug]` | One business: set or extend its plan, its people, its payments, remove it |
| `/admin/demo-requests` | Requests from `/demo` (each is also emailed to the admins) |
| `/admin/payments` | Every payment Razorpay reported |
| `/admin/new` | Set a business up on someone's behalf; the owner gets an invitation |

It shows nothing of a business's conversations or customers. (There used to be a local-only
`/operator` console for adding and testing businesses; self-serve signup, *Try it* and this
replaced it.)

## The public API — `/api/v1/*`

Per-business keys (`ck_…`, Settings → Website & API keys), used from the business's **server**.

| Endpoint | What it does |
| --- | --- |
| `GET /health` | Checks a key; says which features are on |
| `GET /config` | How the business is set up: assistant name, what can be booked, the details it collects |
| `POST /chat` | One customer message → the assistant's reply (streamed with `stream: true`), the details collected so far, and a `proposal` card when a booking or callback is ready |
| `POST /chat/confirm` | The customer's Confirm or Edit on a card — Confirm makes the lead, owner, follow-up and emails |
| `GET /chat` | Replies from a person on the team who took the chat over |
| `POST /chats` | For sites with their own assistant: mirror its transcript |
| `POST /leads` | A booking, callback or enquiry from the site's own forms, with the business's `details` |
| `GET /leads`, `/leads/{id}` · `POST /leads/{id}` | Read leads back — filter by stage, date or any collected detail (`?details.<key>=`) — and update a lead's stage from the business's own system |
| `GET /customers`, `/customers/{id}` | Customers, with everything collected about each |
| `GET /conversations`, `/conversations/{id}` | Chats and calls with the details each collected; one with its transcript |
| `POST /visits` | A visitor, with their cookie consent |
| `POST /voice-sessions` | A five-minute token for a voice call from the visitor's browser |
| Webhooks | `lead.created`, `lead.updated`, `follow_up.created`, `handoff.requested`, `conversation.ended` — signed POSTs to the business's URL |

The reference a developer reads (`/developers`) and the OpenAPI spec are generated from one
file, `lib/integrations/openapi.ts`.

## How the assistant turns conversations into work

- **Grounded answers.** `lib/agent/respond.ts` is one turn: retrieve from the business's
  documents (pgvector, word matching as a fallback), check the escalation triggers, generate
  with every action gated by the authority table, persist the turn with what it cited. Website
  chat and the console's tester run it; voice applies the same rules over Gemini Live.
- **Details to collect** (`lib/business/intake.ts`). The business's own list of fields. The
  assistant is told the list and what is still missing, asks naturally, and records each answer
  as it hears it; the answers sit beside the live transcript and on the lead.
- **Bookings the customer confirms** (`lib/agent/proposals.ts`). In a web chat the assistant
  proposes; a card with Confirm and Edit is the booking step. What a business books — a
  pickup, an appointment, a site visit — comes from its industry template.
- **Leads and follow-ups** (`lib/crm/capture.ts`). One customer and one lead per person,
  however often the assistant saves; owners are picked in code (the account's owner, else
  whoever carries the fewest open leads), never by the model.
- **Handing over.** When the assistant reaches a limit it writes a brief and rings a named
  person (`lib/agent/routing.ts`). Anyone may also just take the line: in a chat their replies
  go to the customer's screen; on a voice call the assistant says it is transferring the caller
  and the person speaks to them from the console (`components/CallRoom.tsx`,
  `lib/voice/relay.ts`).
- **Industry templates** (`lib/business/industries.ts`). Persona, what the assistant may do
  without asking, never-rules, pipeline stage names, default details to collect, what can be
  booked. A new business is answerable the moment it is created.
- **Models.** Website chat answers on Gemini 3.5 Flash Lite; a business's other text work on
  its chosen model; voice on Gemini Live. A stream that is slow to start is hedged with a second
  model (`lib/agent/model.ts`).

## Scripts

```bash
npm run smoke:business                 # add a business, chat as a new customer, check the lead, remove it
npm run smoke:voice -- "+91 40 7xxx xxxx"   # does that number reach its assistant over the local bridge?
npx tsx --tsconfig tsconfig.json scripts/create-api-key.ts <brand-slug> "Website"
npm run db:generate && npm run db:migrate   # after changing lib/db/schema.ts
npm run db:doctor                      # checks the database, the key and a live agent version
```

`npm run typecheck` checks the types. There is no seed and no reset script: a database fills
up by a business signing up at `/welcome`.

## Security

- **Sign-in** is Clerk; every screen and every server action re-checks the role on the server.
- **API keys** are stored hashed. **Connections** a business gives Corva (database, inbox,
  WhatsApp) are sealed with AES-256-GCM under `DATA_SOURCE_KEY`.
- **Rate limits** are counted in the database (`lib/rate-limit.ts`), so they hold across
  server instances: the API per business, chat turns per conversation, WhatsApp per sender,
  the demo form per address, payments per business, and the AI data questions per person.
- **Outbound calls** to addresses a business typed in (webhooks, a website to read, a database
  or mail host) are refused if they resolve to a private address, and redirects are re-checked
  (`lib/net.ts`).
- **Inbound webhooks** (Razorpay, WhatsApp) are verified by signature before anything is read.
- **Headers:** no framing, no content sniffing, HSTS, microphone only (`next.config.ts`).
- **Demo mode** (no sign-in) cannot be switched on in any Vercel deployment.

## Layout

```
app/
  page.tsx                      the public site (content in lib/marketing.ts)
  developers/                   API documentation
  demo/  welcome/               the demo request form; a new business setting itself up
  (console)/app/<route>/        a business's console
  admin/                        Corva's back office
  api/razorpay/*                order, verify, webhook
  api/whatsapp/webhook          Meta's WhatsApp webhook
  api/cron/inbox                the scheduled read of connected inboxes
  api/v1/*                      the public API
  api/voice                     the voice bridge on Vercel (WebSocket)
  api/status                    deployment self-check
lib/
  agent/          the turn pipeline, retrieval, guardrails, authority, proposals, model choice
  voice/          Gemini Live session, the bridge, the person-on-a-call relay
  business/       industries, onboarding, details to collect, phone numbers, reading a website
  crm/            what the assistant writes into the CRM while it talks
  integrations/   API keys, request handling, intake, webhooks, the OpenAPI description
  billing/        plans, usage and limits, Razorpay, the payments ledger
  email/          reading a connected inbox for its customers
  whatsapp/       the WhatsApp Cloud API: connecting, receiving, replying
  data/           a business's own database: sealed connections, read-only queries, lookups
  people/         attendance
  net.ts          checks on addresses other people typed in
  rate-limit.ts   limits that hold across instances
  admin/          who may open /admin, and what it reads
  auth/           sessions, the role matrix, per-screen gates, scope
  actions/        server actions — each re-checks its capability
  queries/        read models, one module per screen
  db/             schema and maintenance scripts
components/       console, admin and public-site UI
drizzle/          migrations
scripts/          the local voice bridge, smoke tests, key creation
docs/             the documents listed above
design/           the original design files, for reference
```

Screens are server components with inline styles against the tokens in `app/globals.css`;
filters, sorts and paging are URL parameters (`lib/params.ts`), so any view can be linked.
