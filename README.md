# Corva

An AI-first customer operations platform — an implementation of the
[Claude Design project](https://claude.ai/design/p/f4333036-c9ee-464d-a9de-f61e736e05ea)
"Modern CMS with AI Support".

The premise: an AI agent answers the helpline, and the console is where humans watch it work,
take over when it hits a limit, and tune the limits themselves. Every screen is built around
showing *why* — why a customer scored 92, why the AI stopped talking, why an intent still
needs a person.

```bash
npm run dev     # http://localhost:3000
npm run build
```

## Three surfaces

The design project is three files, and each becomes its own surface with its own chrome and
its own ground colour.

### `/` — marketing (`Corva Landing.dc.html`)

The public site: hero, a live-console mock, the four-step loop, the eleven scoring axes on an
ink ground, the platform grid, pricing, and the closing call to action.

### `/app/*` — the tenant console (`Corva App.dc.html`)

What a Corva customer uses. The design was a single artboard with twelve states behind a
screen switcher; here each state is a real route, so navigation, deep links and the back
button work.

| Route | Screen |
| --- | --- |
| `/app` | Command center — headline metrics, live calls, priority queue, hourly containment |
| `/app/live` | Live call console — transcript with citations, guardrail stop, entitlements |
| `/app/handoffs` | Handoff queue and the AI-written brief behind each one |
| `/app/conversations` | Conversation archive with per-turn provenance |
| `/app/conversations/[id]` | Permalink into the archive |
| `/app/customers` | Customer table — filters, sort, paging, CSV export |
| `/app/customers/[id]` | Customer 360 — score rationale, record, notes, consent |
| `/app/segments` | Axis weights, override rules, distribution, model alerts |
| `/app/knowledge` | Knowledge base, coverage gaps, AI-readiness score |
| `/app/knowledge/[id]` | Document editor with revisions and a retrieval preview |
| `/app/tuning` | Persona, tone, authority ceilings, guardrails, version diff |
| `/app/analytics` | Containment trend and what the AI still can't finish |
| `/app/team` | Role capability matrix, invites, role changes |
| `/app/setup` | Brands, channels, hours, integrations, privacy, audit log |
| `/app/search` | Across customers, conversations, documents and people |

`/app/customer-360` resolves to whoever is at the top of the priority queue, rather than
pinning the nav to an id that may not exist in a given workspace.

### `/operator/*` — the platform operator console (`Corva Operator Console.dc.html`)

Corva's own staff view across all 148 tenant companies. Dark ground, because it is a different
job for different people — and because the design draws a hard line: staff see tenant *health*,
never tenant transcripts, unless a company grants time-boxed, audited access.

| Route | Screen |
| --- | --- |
| `/operator` | Fleet — every tenant, health-sorted, with the open incident |
| `/operator/companies/[slug]` | Company detail — usage, brands, AI health, flags, billing |
| `/operator/quality` | Cross-tenant failure classes and patterns worth fixing centrally |
| `/operator/revenue` | MRR, plan mix, at-risk accounts, unit economics |
| `/operator/reliability` | Regions, dependencies, incident timeline and updates |
| `/operator/testing` | Voice playground — talk to a tenant's agent over Gemini Live |

## Layout

```
app/
  layout.tsx                    root — html/body and the font, nothing else
  globals.css                   Modernist tokens, app base, hover utilities, dark overrides
  page.tsx                      the marketing site
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
  VoicePlayground.tsx           mic capture and playback for /operator/testing
  ui.tsx                        light primitives — Kicker, Bar, Tag, buttons, Th, …
  operator-ui.tsx               dark primitives — DarkKicker, DarkBar, KpiCell, …
lib/
  db/                           schema, seed and the maintenance scripts
  agent/                        retrieval, guardrails, authority, the turn pipeline
  queries/                      read models, one module per surface
  actions/                      server actions, each re-checking the capability
  voice/                        the Gemini Live session and its cost guards
  marketing.ts                  landing page content
  nav.ts                        console nav groups and the profile href
  config.ts                     the designs' declared props, made real
scripts/
  voice-server.ts               the Gemini Live bridge (npm run voice)
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
`config.accentPriorityThreshold`; a churn bar turns accent at 60; a tenant's health bar turns
accent below `operatorConfig.healthThreshold`.

Filters, sorts and paging are search parameters, not client state (`lib/params.ts`). A filtered
table can be linked and the back button undoes a filter — and a saved view is just a stored copy
of that query, so there is no privileged second path through the same data.

### The designs' props

Both `.dc.html` app files declared canvas knobs in `data-props` and never wired them to
anything. `lib/config.ts` makes them real:

- `accentPriorityThreshold` (75) — drives the accent cutoff the tenant console had hardcoded
- `showAiRationale` (true) — the score breakdown and "what the AI has learned" panels
- `healthThreshold` (70) — the fleet health cutoff, hardcoded in the operator design
- `showSupportAccessGuard` (true) — the tenant-privacy panel on company detail

## Data

Every screen reads Postgres. There are no fixtures left — `lib/data.ts` and
`lib/operator-data.ts` are gone, and the seed builds the world the designs describe: 148
tenants, four brands, a 60-day conversation history, an eleven-axis scoring model with
attributed override rules, and a knowledge base embedded into pgvector.

```bash
npm run db:migrate         # schema
npm run db:seed            # tenants, customers, documents, agent versions
npm run db:embed           # embed the chunks — retrieval returns nothing until you do
npm run db:conversations   # transcripts, citations, handoffs
npm run db:rescore         # let the override rules see the new history
npm run db:doctor          # checks the database, the key, and the live agent version
```

The agent is real: `lib/agent/respond.ts` retrieves, checks the escalation triggers,
generates with every action gated by the authority table, and persists the turn with its
citations. `respondStream()` is the pipeline and `respond()` waits for it, so the console
and the voice bridge run the same code.

## Voice

`/operator/testing` is a playground for talking to a tenant's agent the way a customer
would, over Gemini Live. The bridge is a separate process because Next.js route handlers
cannot hold a WebSocket open:

```bash
npm run voice              # then open /operator/testing
```

Every measurement behind that choice — why the batch API cannot do voice, what the local
alternatives cost, the API corrections — is in [docs/VOICE.md](docs/VOICE.md).
