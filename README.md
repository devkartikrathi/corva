# Corva

An AI front office for small and mid-sized businesses in India. An AI assistant answers the
business's phone and chat 24/7; every caller becomes a customer record, anyone who wants
something becomes a **lead** with an owner on the team, and every "we'll call you back" becomes
a **follow-up** with a name and a time on it. The team works those from one console, and the
owner can see who is winning leads and keeping promises.

Built for India: every figure is rupees, stored as paise and printed with Indian grouping
(₹12,49,500, not ₹1,249,500). `lib/money.ts` is the only place that decides how money reads.

```bash
npm run dev     # http://localhost:3000
npm run voice   # the voice bridge, for test calls
```

## The demo, end to end

1. **Add a business** — `/operator/onboarding`. Name, industry, website, anything the owner
   wants the AI to know, and the team (`Name, email, role` per line). Corva reads the website,
   turns it into knowledge, sets up an AI assistant from the industry template, and gives the
   business a phone number (a free `+91 40 7xxx xxxx` test line unless you give one).
2. **Call it** — `/operator/testing`. Dial the number. Your own number decides who you are: a
   number the business has never seen makes you a new caller, which is where leads come from;
   pick a known customer to be recognised instead.
3. **Watch it land** — "Open their console" (demo mode signs you in as the owner). The call is
   on Live calls with a *Recorded on this call* panel; the AI's lead is on **Leads** with an
   owner; its promised callback is on **Follow-ups** and on **Home**. Take the line at any point
   and the AI goes quiet.
4. **Work it** — move leads through the business's own stages (a clinic's are *New enquiry →
   Appointment booked → Visited → Became a patient*), tick follow-ups off, and see it add up on
   **Team → Performance**: leads owned and won, conversion, follow-ups done on time.

The same path without a browser or a microphone:

```bash
npm run smoke:business                       # add a clinic, chat as a new caller, check lead + follow-up
VOICE_BRIDGE_PORT=8787 npm run smoke:voice -- "+91 40 7xxx xxxx"   # does that number reach its AI?
```

## Two surfaces

### `/app/*` — a business's console

| Group | Route | Screen |
| --- | --- | --- |
| Operate | `/app` | Home — follow-ups due, newest leads, live calls, who needs a person |
| | `/app/live` | Live call — transcript with citations, take the line, what the call recorded |
| | `/app/handoffs` | Handoffs the AI raised, with the brief it wrote |
| | `/app/conversations` | Every conversation, with per-turn provenance |
| Sales | `/app/leads` | The pipeline, in the industry's own stage names |
| | `/app/follow-ups` | Callbacks and promises — overdue, today, upcoming, done |
| | `/app/customers` | Customers, and each one's record: leads, follow-ups, conversations, notes |
| AI assistant | `/app/knowledge` | What the AI may answer from; gaps it found |
| | `/app/tuning` | Persona, tone, what it may do on its own, when it hands over |
| | `/app/analytics` | Containment and what the AI still cannot finish |
| Team | `/app/performance` | Per person: leads owned and won, follow-ups on time, handoffs |
| | `/app/team` | People, roles and invites |
| | `/app/setup` | Number, channels, hours, privacy, audit log |

An **Agent** sees their own leads, follow-ups and customers; a **Manager** or **Owner** sees the
whole business and can reassign. The scope comes from the `customers.read` grant in the role
matrix (`lib/auth/permissions.ts`, `lib/auth/scope.ts`), and every action re-checks it.

In demo mode (`CORVA_DEMO`, on unless set to `0`) nobody signs in: the console opens as a seeded
member, the profile switcher in the sidebar shows the same business as someone else, and
Corva's own console can open any business as its owner (`lib/auth/enter.ts`).

### `/operator/*` — Corva's own console

| Route | Screen |
| --- | --- |
| `/operator` | Businesses — whether each can take a call, its number, calls and leads this week |
| `/operator/onboarding` | Add a business |
| `/operator/companies/[slug]` | One business — number, model, what its AI knows, team, recent calls, remove |
| `/operator/testing` | Test calls — the dialer |

## How the AI turns calls into work

- **Routing by number.** `lib/business/phone.ts` normalises numbers to digits; the voice bridge
  resolves the dialled number to a business and the caller's number to a customer, creating a
  contact for anyone new (`lib/voice/session.ts`, `lib/crm/capture.ts`).
- **Two CRM tools**, on voice and on text: `save_caller_details` writes or updates the lead (one
  per conversation, and a returning caller's open lead is reused), and `schedule_follow_up`
  creates the task. Owners are chosen in code — the account owner, else whoever on the team
  carries the fewest open leads — never by the model.
- **Industry templates** (`lib/business/industries.ts`) give a new business its persona, what it
  may do without asking, escalation rules, never-rules, what to ask a new caller, and the words
  its pipeline uses. Stage *keys* are shared so reports work across industries.
- **Knowledge from the website** (`lib/business/website.ts`) — the home page and the few pages
  most likely to hold answers, rewritten into "Topic: fact" paragraphs. Retrieval falls back to
  word matching when embeddings are unavailable, and model calls fall through to a sibling Gemini
  model when one is overloaded (`lib/agent/model.ts`).
- **Handing over.** When the AI hits a limit it writes a brief and rings a named person
  (`lib/agent/routing.ts`, `components/TransferAlert.tsx`). Taking the line silences the AI —
  on voice too: the bridge drops its audio and refuses its tools while a person holds the call.

## Layout

```
app/
  layout.tsx                    root — html/body and the font, nothing else
  globals.css                   Modernist tokens, app base, hover utilities, dark overrides
  page.tsx                      the marketing site (not yet updated for the new direction)
  (console)/
    layout.tsx                  tenant shell — sidebar + sticky top bar
    app/<route>/page.tsx        the tenant screens
  (operator)/
    layout.tsx                  staff shell — dark header + tab bar
    operator/<route>/page.tsx   the operator screens
components/
  Sidebar.tsx  OperatorNav.tsx  nav shells (they need usePathname)
  TopBar.tsx
  filters.tsx                   URL-driven chips, tabs, sort headers, pagers
  ActionButton.tsx              a button that runs a server action and shows refusals
  TransferAlert.tsx             the AI asking for you, by name
  VoicePlayground.tsx           the dialer: mic capture and playback for /operator/testing
  CrmControls.tsx               stage/owner selects, follow-up buttons, add-lead and add-follow-up
  OnboardCompany.tsx            the add-a-business form
  ui.tsx                        light primitives — Kicker, Bar, Tag, buttons, Th, …
                                ScreenRefusal — what a screen you may not open says
  operator-ui.tsx               dark primitives — DarkKicker, KpiCell, DarkTh, …
lib/
  db/                           schema, seed and the maintenance scripts
  agent/                        retrieval, guardrails, authority, the turn pipeline
                                routing.ts — who a transferred call rings at
                                summary.ts — the one line, for whoever takes over
  auth/                         session, the role matrix, and the per-screen gate
                                screen.ts — the check every gated page opens with
                                scope.ts — whose customers "theirs" means
  queries/                      read models, one module per surface
  actions/                      server actions, each re-checking the capability
  voice/                        the Gemini Live session and its cost guards
  business/                     industries, onboarding, phone numbers, reading a website
  crm/capture.ts                what the AI writes into the CRM while it talks
  knowledge/                    chunking and indexing documents
  money.ts                      rupees, paise, and Indian digit grouping
  marketing.ts                  landing page content
  nav.ts                        console nav groups, filtered by capability
  config.ts                     display thresholds
scripts/
  voice-server.ts               the Gemini Live bridge (npm run voice)
  smoke-business.ts             add a business and chat to it as a new caller
  smoke-voice.ts                check a number reaches its AI over the bridge
design/                         the three source designs, for reference
docs/VOICE.md                   voice measurements, gotchas and the case for Sarvam
```

### Styling

The design system is plain CSS custom properties (`design/_ds/…/styles.css`), reproduced
verbatim at the top of `app/globals.css`. Screens use inline styles the way the designs did —
these are layouts of one-off measurements (`108px` timeline gutters, `9.5px` tracked-out
labels), not sets of repeating components, and inlining keeps each screen readable against its
source. What *does* repeat lives in `components/ui.tsx` and `components/operator-ui.tsx`.

The designs carried hover states as `style-hover` attributes on individual elements. Those
became utility classes (`.hov-raise`, `.hov-invert`, `.hov-accent-dark`, …) so each hover rule
exists once.

The operator console inverts the palette — ink is the ground, `--color-bg` is the ink. Rather
than a second token set, `.operator-root` scopes the overrides, and `body:has(.operator-root)`
paints the page behind it so overscroll doesn't flash light.

### Derived values

The designs computed presentation values — bar widths, accent thresholds, tag colours — inside
their render functions. The `lib/queries/*` modules do the same on the way out of the database,
so a screen stays a layout and a threshold lives in one place. A score is drawn in accent above
`config.accentPriorityThreshold`; a churn bar turns accent at 60.

Filters, sorts and paging are search parameters, not client state (`lib/params.ts`). A filtered
table can be linked and the back button undoes a filter — and a saved view is just a stored copy
of that query, so there is no privileged second path through the same data.

### The designs' props

Both `.dc.html` app files declared canvas knobs in `data-props` and never wired them to
anything. `lib/config.ts` makes them real:

- `accentPriorityThreshold` (75) — drives the accent cutoff the tenant console had hardcoded
- `showAiRationale` (true) — the score breakdown and "what the AI has learned" panels

## Data

Every screen reads Postgres. There are no fixtures left — `lib/data.ts` and
`lib/operator-data.ts` are gone, and the seed builds the world the designs describe: 148
tenants, four brands, a 60-day conversation history, an eleven-axis scoring model with
attributed override rules, and a knowledge base embedded into pgvector.

```bash
npm run db:reset           # drops public *and* drizzle's migration ledger
npm run db:migrate         # schema
npm run db:seed            # tenants, customers, documents, agent versions
npm run db:conversations   # transcripts, citations, handoffs
npm run db:rescore         # let the override rules see the new history
npm run db:embed           # embed the chunks (retrieval falls back to word matching until you do)
npm run db:crm             # a week of demo leads and follow-ups for Aurelius Home
npm run db:doctor          # checks the database, the key, and the live agent version
```

`npm run check:sql` touches no database. It asserts how this drizzle instance
renders an interpolated column, because that differs by position and a query
that gets it wrong returns wrong numbers rather than an error — see the note on
`db` in [lib/db/index.ts](lib/db/index.ts).

The order matters and the script names do not say so: `db:conversations` needs customers and
a live agent version, and `db:rescore` needs the conversation history or every score comes
out model-only.

The agent is real: `lib/agent/respond.ts` retrieves, checks the escalation triggers,
generates with every action gated by the authority table, and persists the turn with its
citations. `respondStream()` is the pipeline and `respond()` waits for it, so the console
and the voice bridge run the same code.

## Voice

`/operator/testing` is a dialer for ringing a business's AI the way a customer would, over
Gemini Live. The bridge is a separate process because Next.js route handlers cannot hold a
WebSocket open:

```bash
npm run voice              # then open /operator/testing
```

Every measurement behind that choice — why the batch API cannot do voice, what the local
alternatives cost, the API corrections — is in [docs/VOICE.md](docs/VOICE.md).
