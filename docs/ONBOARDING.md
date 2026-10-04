# Bringing a business onto Corva

Every business comes on the same way, and most do it themselves. Tumble Days was the first;
nothing below is particular to it.

## The usual way: the business signs itself up

1. **`/sign-up`** — the owner creates an account and verifies their email.
2. **`/welcome`** — one form: the business's name, what kind of business it is, its website
   (or a few lines about what it offers), a name for the assistant. Submitting it creates the
   business, the assistant from the industry template, the knowledge read from the website,
   the default **Details to collect**, and the Owner seat — theirs at once. It takes about a
   minute, and starts a **14-day pilot**: 100 chats, 30 voice minutes, no card.
3. **`/app`** opens with a *Getting started* list that ticks itself off:

   | Step | Where |
   | --- | --- |
   | Talk to the assistant as a customer would | **Try it** — chat or call; free, kept out of the numbers |
   | Check what it knows | **Knowledge** — correct or add to what it read |
   | List what it sells | **Products & services** — groups, items, prices; the assistant quotes them |
   | Choose what it collects | **Details to collect** |
   | Invite the team | **People & roles** — leads and follow-ups are given to people here |
   | Put it on the website | **Settings → Website & API keys**, and hand the key to their developer |
   | Choose a plan | **Billing** — before the pilot ends |

A person whose email already has an invitation waiting lands in that business instead; one
person sets up one business this way (more brands are added from Settings, on a plan that
covers them).

## After a demo: we set it up for them

Someone fills in **`/demo`**. The request is emailed to the admins (`CORVA_ADMIN_EMAILS`) and
listed at **`/admin/demo-requests`**. After talking to them, either send them to `/sign-up`,
or do it for them:

- **`/admin/new`** — the same form, plus the owner's email and optionally the team
  (`Name, email, role` per line). The owner gets an invitation; signing up with that email
  puts them in the Owner seat.
- **`/admin/businesses/<slug>`** — give them a longer pilot, or put them on a plan paid some
  other way (*Set plan … for N days*).

## What we need from them, either way

| | Why |
| --- | --- |
| Business name, and what kind of business it is | Picks the industry template: what the assistant may do, what it collects, what can be booked and its word for it, how customers are segmented. (The leads board is the same five stages for everyone.) |
| Website address | Corva reads it into the assistant's knowledge |
| Their price list | Products & services (`/app/catalog`), so the assistant quotes real prices |
| Anything the site does not say — hours, policies, service area | Typed in as a second document |
| Any discounts they give | Offers (Settings → Offers) — the only discounts the assistant may mention |
| How they take payment today | Their own endpoint (developer), Collected by Corva (switched on in `/admin`), or none yet |
| The owner's **email** | The Owner seat; it is how they sign in |
| The team: name, email, role for each | Invitations, and who leads and follow-ups can be given to |
| What to call the assistant | Its name in chat and on calls |

## Their developer's part

Everything is at `/developers` on the live site; [INTEGRATION.md](INTEGRATION.md) is the
guide: what to build, the rules behind the API, the checklist and what changed. Two environment
variables on their server — `CORVA_API_URL` and `CORVA_API_KEY` — and their chat window talks to
the assistant. Order status (`/records`), a payment endpoint and a webhook receiver are optional
additions.

## Before we call it live

- [ ] `/api/v1/health` with their key returns `ok` from their production site
- [ ] A chat on their site books (or requests a callback) and it appears under Leads with an owner and a follow-up
- [ ] Closing the chat ends the conversation (it leaves Live within seconds, not after 30 minutes)
- [ ] Someone on their team takes a chat over and the customer sees their reply
- [ ] A voice call from the site connects, and a person can take it over (if they use voice)
- [ ] The confirmation email arrives — needs a verified sending domain (`EMAIL_FROM`)
- [ ] Their Details to collect are the ones they actually need, and show on the lead
- [ ] If they take payments: in *Try it*, ask the assistant to pay for a test order — it asks for
      a code, the request waits on Handoffs, *Approve & send* delivers the link, and paying it
      marks the payment paid and the lead Converted
- [ ] A verification code reaches a customer (email works at once; SMS needs their provider and
      DLT `otp` template)
- [ ] Each team member has signed in once
- [ ] They are on a plan, or know the day the pilot ends

## Looking after a business

`/admin` lists every business with its plan, when it ends, its usage and its last
conversation — the ones ending soon or stopped are marked. `/admin/businesses/<slug>` is where
a plan is extended or changed, and where a business is removed (type its name to confirm; it
deletes everything in it — export first if they will want their data: `/app/customers` exports
CSV, each conversation exports its transcript).

`npm run smoke:business` runs the creation path end to end against a throwaway business.
