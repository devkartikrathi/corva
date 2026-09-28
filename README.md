# Corva

An AI-first customer operations platform — an implementation of the
[Claude Design project](https://claude.ai/design/p/f4333036-c9ee-464d-a9de-f61e736e05ea)
"Modern CMS with AI Support".

The premise: an AI agent answers the helpline, and the console is where humans watch it work,
take over when it hits a limit, and tune the limits themselves. Every screen is built around
showing *why* — why a customer scored 92, why the AI stopped talking, why an intent still
needs a person.

Built for India: every figure is rupees, stored as paise and printed with Indian grouping
(₹12,49,500, not ₹1,249,500). `lib/money.ts` is the only place that decides how money reads.

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
| `/app/customers/[id]` | Customer 360 — score rationale and history, record, notes, consent |
| `/app/performance` | Team performance — per-agent handling, ratings, ownership |
| `/app/segments` | Axis weights, override rules, distribution, model alerts |
| `/app/knowledge` | Knowledge base, coverage gaps, AI-readiness score |
| `/app/knowledge/[id]` | Document editor with revisions and a retrieval preview |
| `/app/tuning` | Persona, tone, authority ceilings, guardrails, version diff |
| `/app/analytics` | Containment trend and what the AI still can't finish |
| `/app/team` | Role capability matrix, invites, role changes |
| `/app/setup` | Brands, channels, hours, integrations, privacy, audit log |
| `/app/search` | Across customers, conversations, documents and people |

There is one way into a customer, not two: the list is the entry point and a row takes you to
the profile. (A second nav item, "Customer 360", used to resolve to whoever was top of the
priority queue — but a nav entry that lands somewhere different every time you press it is not
navigation.)

### Two jobs, one console

The tenant console is two different jobs behind one URL, and which one you get is the role you
hold — enforced server-side, not hidden with CSS.

| | Agent | Manager / Owner |
| --- | --- | --- |
| Customers | the accounts they hold, or are mid-conversation with | every account, and who holds it |
| Conversations | their customers' | the brand's |
| Command centre | *their* priority queue | the brand's |
| Team performance | not in the nav, and refuses on the URL | who is carrying what, and how well |
| Transfer alert | yes | yes |

An Agent's `customers.read` grant is `assigned`; everyone above them holds it `full`. The
scope is derived from that grant rather than from the role name (`lib/auth/scope.ts`), so a
new role with an `assigned` grant is scoped without touching a screen. "Theirs" is one SQL
predicate in `lib/queries/scoping.ts` — the accounts they own *plus* the ones they are
actually talking to, because somebody who has just taken a transferred call has a
relationship with that customer whether or not anyone has set an owner yet.

The profile switcher in the bottom-left corner exists so you can see both. It is demo-mode
only — with Clerk on, identity comes from the signed-in user and the cookie is never read —
and it substitutes *who is asking*, never what they may do.

Hiding a screen is not withholding it, so every gated screen opens with `guardScreen()`
(`lib/auth/screen.ts`), which reads the same matrix `lib/nav.ts` reads and applies the same
rule: a grant of `none` closes the screen, anything above it lets you in. The sidebar cannot
offer a screen that refuses, and typing the URL cannot reach one the sidebar withheld — an
Analyst is bounced off `/app/live`, a Manager off `/app/segments`. The test is `grant` and
not `allowed` on purpose: `read_only` is a refusal to *write*, and a screen you may read but
not change is exactly an Analyst's job. A refusal names the reason and points at where that
person's version of the answer lives, because they usually got there from a stale bookmark
or a role that changed under them.

### When the AI hands over

The design queued a handoff and left it there. A queue is a screen you have to be looking at,
which on a live call is far too late — so a transfer now rings at a named person:

1. whoever is already talking to that customer, if they are free
2. whoever owns the account
3. free, highest rated, lightest queue — in that order

`lib/agent/routing.ts` chooses; `components/TransferAlert.tsx` interrupts whatever screen
they are on with three facts and two buttons. Passing on re-routes and records who passed, so
it is not offered straight back. If nobody is free the handoff waits unassigned rather than
landing on someone who said they could not take it.

The card leads on one line — what the customer wants and where it stuck — because reading a
brief is what you do *after* you have taken the line and said hello. That line is
`conversations.live_summary`: written by the model when a handoff is raised, refreshed as a
conversation moves, and rate-limited so an open console cannot turn it into a billing line
(`lib/agent/summary.ts`).

### The other way a "no" can end

An authority ceiling used to have one exit: refuse, and queue a human. But a customer who is
told no and accepts it is a real and common outcome, and it left no trace at all — nothing
was spent, nobody was queued, so nothing reached anyone.

So a refusal now offers exactly two options and waits: a colleague who can decide, or leaving
it where it is. If they take the second, the agent thanks them, closes, and writes a
`closure_approval` handoff — same queue, different question. Somebody confirms it was right,
or records that it was not. One row is the difference between a refusal being policy and a
refusal being a habit nobody noticed.

Both paths exist on both channels: `close_with_agreement` is a tool in `lib/agent/respond.ts`
and in `lib/voice/session.ts`.

### `/operator/*` — the platform operator console (`Corva Operator Console.dc.html`)

Corva's own staff view across all 148 tenant companies. Dark ground, because it is a different
job for different people — and because the design draws a hard line: staff see tenant *health*,
never tenant transcripts, unless a company grants time-boxed, audited access.

| Route | Screen |
| --- | --- |
| `/operator` | Fleet — every tenant, health-sorted, and the open incident to act on |
| `/operator/companies/[slug]` | Company detail — usage, brands, AI health, flags, billing |
| `/operator/quality` | Cross-tenant failure classes and patterns worth fixing centrally |
| `/operator/revenue` | MRR, plan mix, at-risk accounts, unit economics |
| `/operator/reliability` | Regions, dependencies, incident timeline and updates |
| `/operator/testing` | Voice playground — talk to a tenant's agent over Gemini Live |

The fleet's incident card is where an operator first learns something is wrong, so both things
you do about it happen there rather than one screen further on: post an update, or fail the
region over. Failing over moves *traffic* and not residency — `organizations.region` is where
a tenant's data lives, and a latency incident is not consent to move it — so the region's
state changes, the tenant rows do not, and the incident gets an update recording where traffic
went and how many companies moved. Posting expands the same form the Reliability page uses,
because there should be one incident update form and two places to reach it.

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
  TransferAlert.tsx             the AI asking for you, by name
  VoicePlayground.tsx           mic capture and playback for /operator/testing
  ui.tsx                        light primitives — Kicker, Bar, Tag, buttons, Th, …
                                ScreenRefusal — what a screen you may not open says
  operator-ui.tsx               dark primitives — DarkKicker, DarkBar, KpiCell, …
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
  money.ts                      rupees, paise, and Indian digit grouping
  marketing.ts                  landing page content
  nav.ts                        console nav groups, filtered by capability
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
npm run db:reset           # drops public *and* drizzle's migration ledger
npm run db:migrate         # schema
npm run db:seed            # tenants, customers, documents, agent versions
npm run db:conversations   # transcripts, citations, handoffs
npm run db:rescore         # let the override rules see the new history
npm run db:embed           # embed the chunks — retrieval returns nothing until you do
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

`/operator/testing` is a playground for talking to a tenant's agent the way a customer
would, over Gemini Live. The bridge is a separate process because Next.js route handlers
cannot hold a WebSocket open:

```bash
npm run voice              # then open /operator/testing
```

Every measurement behind that choice — why the batch API cannot do voice, what the local
alternatives cost, the API corrections — is in [docs/VOICE.md](docs/VOICE.md).
