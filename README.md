# Corva

An AI front office for small and mid-sized businesses in India.

Each business gets an AI assistant that answers its **website chat**, **voice calls from the
website**, and its **phone number** — from the business's own knowledge, inside limits the
business sets. Every conversation becomes work the team can act on: a **customer** record, a
**lead** with an owner, a **follow-up** with a name and a time. The team works those from one
console, can **take any chat or call over live**, and the owner can see who is winning leads
and keeping promises.

Three things in one product, on purpose:

| | What it is | Who uses it |
| --- | --- | --- |
| **AI assistant** | Chat and voice, grounded in the business's documents, with bookings the customer confirms | The business's customers |
| **Customer management** | Customers, leads in the business's own pipeline words, follow-ups, the details the business chose to collect | The business's team |
| **Team management** | People and roles, who owns what, performance per person, an audit log | The business's owner |

A business connects in whichever way suits it — and they all reach the same assistant and land
in the same console:

1. **The API** — its website's chat window and voice button talk to Corva (`/developers`).
2. **A phone number** — callers reach the assistant; no code at all.
3. **Its own assistant or forms** — it keeps what it has and sends Corva the results.

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

- `/` — the public site · `/developers` — API docs · `/app` — a business's console
- `/operator` — Corva's own console, where businesses are added. **Local only**: it does not
  exist on a deployment.
- `/api/status` — which pieces are configured (never a secret's value).

## Documentation

| Read | For |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit: the turn pipeline, voice, handover, tenancy, where things live |
| [docs/ONBOARDING.md](docs/ONBOARDING.md) | Bringing a new business on, step by step — ours and theirs |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | What a business's developer builds; the checklist we hold an integration to |
| `/developers` (live) | The API reference, generated from `lib/integrations/openapi.ts`; also `/api/v1/openapi.json` |
| [docs/PRICING.md](docs/PRICING.md) | The plans, what they cost us to serve, and what is not built yet |
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
| Sales | `/app/leads` | The pipeline, in the business's own stage names, with collected details on each card |
| | `/app/follow-ups` | Callbacks and promises — overdue, today, upcoming, done |
| | `/app/customers` | Customers and each one's record: leads, follow-ups, conversations, website visits |
| AI assistant | `/app/knowledge` | What the AI may answer from; gaps it found |
| | `/app/tuning` | Persona, tone, what it may do alone, when it hands over — drafted, then published |
| | `/app/details` | **Details to collect** — the fields the AI asks every customer for |
| | `/app/analytics` | Containment and what the AI still cannot finish |
| Team | `/app/performance` | Per person: leads owned and won, follow-ups on time, handoffs |
| | `/app/team` | People, roles and invitations |
| | `/app/setup` | Settings — number, channels, hours, **API keys**, **webhooks**, privacy, audit log |

Roles are Owner, Admin, Manager, Agent and Analyst (`lib/auth/permissions.ts`). An Agent sees
their own leads, follow-ups and customers; a Manager or Owner sees the whole business. Every
screen and every action re-checks the capability on the server.

Sign-in is Clerk; roles and memberships live in Postgres. Signing in with a *verified* email
claims whatever is waiting for it — an invitation or the Owner seat created at onboarding
(`claimByEmail`, `lib/auth/session.ts`).

## Corva's own console — `/operator/*` (local only)

| Route | Screen |
| --- | --- |
| `/operator` | Businesses — whether each can take a call, its number, activity this week |
| `/operator/onboarding` | Add a business: name, industry, website, what the AI should know, owner, team |
| `/operator/companies/[slug]` | One business — number, model, knowledge, team, recent calls, remove |
| `/operator/testing` | Ring a business's assistant from a dialer, or chat to it as a customer |

`OPERATOR_AVAILABLE` (`lib/auth/mode.ts`) is false on any Vercel deployment and `proxy.ts`
returns 404 for `/operator*` there. Businesses are onboarded from a Corva team member's
machine against the shared database.

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

`npm run db:seed` and its siblings (`db:conversations`, `db:crm`, `db:rescore`, `db:embed`)
build a fictional demo workspace on an **empty** database. Do not run them against the
database real businesses live in.

## Layout

```
app/
  page.tsx                      the public site (content in lib/marketing.ts)
  developers/                   API documentation
  (console)/app/<route>/        a business's console
  (operator)/operator/<route>/  Corva's own console (local only)
  api/v1/*                      the public API
  api/voice                     the voice bridge on Vercel (WebSocket)
  api/status                    deployment self-check
lib/
  agent/          the turn pipeline, retrieval, guardrails, authority, proposals, model choice
  voice/          Gemini Live session, the bridge, the person-on-a-call relay
  business/       industries, onboarding, details to collect, phone numbers, reading a website
  crm/            what the assistant writes into the CRM while it talks
  integrations/   API keys, request handling, intake, webhooks, the OpenAPI description
  auth/           sessions, the role matrix, per-screen gates, scope
  actions/        server actions — each re-checks its capability
  queries/        read models, one module per screen
  db/             schema and maintenance scripts
components/       console and operator UI
drizzle/          migrations
scripts/          the local voice bridge, smoke tests, key creation
docs/             the documents listed above
design/           the original design files, for reference
```

Screens are server components with inline styles against the tokens in `app/globals.css`;
filters, sorts and paging are URL parameters (`lib/params.ts`), so any view can be linked.
