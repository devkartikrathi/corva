# The plan

Where Corva is going, in the order we intend to build it. The roadmap
([ROADMAP.md](ROADMAP.md)) lists what businesses will ask for; this is the shape we are
building toward and the next steps to get there.

## What Corva is

A customer management and employee management system for any business, with AI in it from the
start. Three parts:

1. **An assistant per business**, on its website, its WhatsApp and its calls, with a
   personality the business gives it.
2. **Customer management** across every channel the business is reached on, with the customer
   profile the business wants to keep.
3. **Employee management**: who is at work, who did what, drawn for the owner, the manager and
   each person.

Corva does not run the business's operations. Orders, jobs, stock and invoices belong to the
business's own system, which talks to Corva over the API and webhooks.

## Corva and what is built on it

Tumble Days is a laundry: its own site and admin hold orders, dispatch, the schedule and
revenue reports. It uses Corva for the assistant, customers and team. That split is the model:

| Layer | Owns | Example |
|---|---|---|
| Corva | Assistant, customers, conversations, leads, follow-ups, team, attendance | Any business |
| A business's own system | Orders, pricing, operations, revenue | Tumble Days' admin |
| Possibly later: a vertical product | A ready-made operations system for one trade, on top of Corva | "Corva for laundries" |

A vertical product would be its own project. It is not started.

## Next, in order

### 1. Customer profiles the business designs

Today a customer has a name, phone, email and location, and "Details to collect" defines what
the assistant asks on each conversation (stored on the lead).

To build:

- A **customer profile** per business: a set of fields chosen from a catalogue and added to
  freely. The catalogue starts wide: date of birth, anniversary, gender, alternate phone,
  address lines, city, pincode, language, preferred contact time and channel, company, GST
  number, source, tags, notes, preferences.
- Each field has a type (text, number, date, choice, yes/no), whether it is required, and
  whether the **assistant may ask for it**, the **team fills it in**, or both.
- Values live in one JSON column on the customer, keyed by field, as lead details do today.
  No migration per business, filterable over the API with `profile.<key>=`.
- The profile shows on the customer's page, is editable there, and is included in the read API
  and webhooks.
- Industry templates set a sensible starting profile; "Details to collect" becomes the part of
  the profile the assistant gathers.

### 2. A personality for each assistant

Today a business sets a name, a persona paragraph, tone sliders, what the assistant may do and
what it must never say.

To build:

- A guided **personality** screen: who it is, how it greets, how formal, which languages, how
  it handles a complaint, with a live preview conversation beside it.
- **"Write it for me"**: the business describes itself in a few lines, or points at its
  website, and Corva drafts the persona and rules for review. Later, a button to ask Corva's
  team to write it.
- A voice chosen per business for calls.

### 3. Anonymous enquiries

Someone asks a question, gives no name or number, and leaves. Built today: these are kept but
left out of Conversations by default, behind an "Anonymous enquiries" filter, and idle chats
and calls close themselves.

To build:

- Count them on the overview as their own figure (asked, did not identify).
- A retention window for them shorter than for identified customers, set by the business.
- A weekly digest of what anonymous visitors asked that the assistant could not answer.

### 4. More of every channel

WhatsApp templates and outbound messages, replying to email from Corva, a real telephone
number, Google and Microsoft sign-in for mail. Detail is in the roadmap.

### 5. Employee management, further

Shifts and leave requests, targets per person, a manager's view of only their own team, and a
daily summary to the owner.

## Before going live widely

- A Clerk production instance on the Corva domain.
- Razorpay keys, a GST invoice per payment.
- A verified sending domain for email.
- WhatsApp and the email inbox tried against a real number and a real inbox.
- A paid Vercel plan (longer calls, native cron), or moving the scheduler off GitHub.
- Backups: a scheduled export of the database, and a restore tried once.
- Error reporting and uptime checks on `/api/status`.

## How changes are made safely

- Schema changes are additive first. A column or table is dropped only after the code that
  stopped using it is deployed.
- Anything an outside system depends on (the API, webhooks) changes by addition; a field is
  never renamed in place.
- Every feature is tried end to end on the live site after it ships, and its test data removed.
