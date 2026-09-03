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
| `/app/customers` | Filterable customer table |
| `/app/customers/marguerite-okonkwo` | Customer 360 — score rationale, timeline, signals |
| `/app/segments` | Axis weights, override rules, scoring simulation |
| `/app/knowledge` | Knowledge base, coverage gaps, AI-readiness score |
| `/app/tuning` | Persona, authority ceilings, guardrails, version replay |
| `/app/analytics` | Containment trend and what the AI still can't finish |
| `/app/team` | Role capability matrix and people |
| `/app/setup` | Brands, channels, integrations, privacy, plan |

Customer 360 is the one profile with a full record in the fixtures, so `/app/customers/[slug]`
generates just that page and 404s on any other slug.

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
| `/operator/reliability` | Regions, dependencies, incident timeline |

## Layout

```
app/
  layout.tsx                    root — html/body and the font, nothing else
  globals.css                   Modernist tokens, app base, hover utilities, dark overrides
  page.tsx                      the marketing site
  (console)/
    layout.tsx                  tenant shell — sidebar + sticky top bar
    app/<route>/page.tsx        the twelve tenant screens
  (operator)/
    layout.tsx                  staff shell — dark header + tab bar
    operator/<route>/page.tsx   the five operator screens
components/
  Sidebar.tsx  OperatorNav.tsx  the two client components (they need usePathname)
  TopBar.tsx
  ui.tsx                        light primitives — Kicker, Bar, Tag, buttons, Th, …
  operator-ui.tsx               dark primitives — DarkKicker, DarkBar, KpiCell, …
lib/
  data.ts                       tenant console fixtures, with derived colours and widths
  operator-data.ts              operator console fixtures
  marketing.ts                  landing page content
  nav.ts                        console nav groups and the profile href
  config.ts                     the designs' declared props, made real
design/                         the three source designs, for reference
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
their render functions. The `lib/*-data.ts` modules do the same at module scope, so a screen
never re-derives them inline. A score is drawn in accent above `config.accentPriorityThreshold`;
a churn bar turns accent at 60; a tenant's health bar turns accent below
`operatorConfig.healthThreshold`.

### The designs' props

Both `.dc.html` app files declared canvas knobs in `data-props` and never wired them to
anything. `lib/config.ts` makes them real:

- `accentPriorityThreshold` (75) — drives the accent cutoff the tenant console had hardcoded
- `showAiRationale` (true) — the score breakdown and "what the AI has learned" panels
- `density` (Comfortable) — row padding
- `healthThreshold` (70) — the fleet health cutoff, hardcoded in the operator design
- `showSupportAccessGuard` (true) — the tenant-privacy panel on company detail

## Data

Every screen runs on fixtures. There is no backend, no database, and no AI call yet — the
transcripts, scores, and metrics are the designs' own sample content, ported intact. Making
this real is the next step: Neon Postgres with pgvector, Clerk for auth and the
Owner/Admin/Manager/Agent/Analyst roles, and a retrieval-grounded agent over the knowledge
base for the text channels.
