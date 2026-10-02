# Bringing a business onto Corva

Every business comes on the same way. Tumble Days was the first; nothing below is particular
to it. The whole thing is an afternoon: about twenty minutes of ours, the same of the owner's,
and — if they want the assistant on their own website — a few hours of their developer's.

## What we need from them

| | Why |
| --- | --- |
| Business name, and what kind of business it is | Picks the industry template: pipeline words, what the assistant may do, what it collects |
| Website address | Corva reads it into the assistant's knowledge |
| Anything the site does not say — prices, hours, policies, service area | Pasted in as a second document |
| The owner's name and **email** | Becomes the Owner seat; that email is how they sign in |
| The team: name, email, role for each | Invitations, and who leads and follow-ups can be given to |
| What to call the assistant | Its name in chat and on calls |
| A phone number, if they have one to point at us | Otherwise they get a Corva test line |

## Our part — on a Corva team machine

The operator console is local only (`npm run dev` → `http://localhost:3000/operator`), against
the shared database.

1. **`/operator/onboarding`** — fill in the form above and submit. In one go this creates the
   organization and brand, the assistant from the industry template, the knowledge (website +
   pasted text, embedded), a phone line, the Owner seat and team invitations, and the default
   **Details to collect**.
2. **`/operator/testing`** — ring the number and chat to it as a new customer. Check it answers
   from their facts, asks for the right details, and that a lead and follow-up appear.
3. **`/operator/companies/<slug>`** — look over what the assistant knows; fix the model or the
   number if needed.
4. Tell the owner to sign in at the live site with the email we entered.

`npm run smoke:business` runs the same path end to end against a throwaway business.

## Their part — the owner, in the live console

1. **Sign up** at `/sign-up` with the Owner email and verify it. `/app` opens their business.
2. **Knowledge** — read what the assistant knows; correct anything; add what is missing.
3. **Behaviour & limits** — the persona, what it may do on its own (and up to how much), what
   it must never say, when it hands over. Changes are drafted, then published.
4. **Details to collect** — the fields the assistant asks every customer for. Add, remove,
   reorder, mark required. This is the list their team will see filled in on every lead.
5. **People & roles** — invite the team. Leads and follow-ups are only given to people who
   exist here.
6. **Settings** — hours, and for a website integration: **make an API key** and hand it to
   their developer; optionally add a **webhook** to their own system.

## Their developer's part

Everything is at `/developers` on the live site; [INTEGRATION.md](INTEGRATION.md) is the short
version and the checklist. Two environment variables on their server — `CORVA_API_URL` and
`CORVA_API_KEY` — and their chat window talks to the assistant.

A business that only wants the phone line has nothing to build.

## Before we call it live

- [ ] `/api/v1/health` with their key returns `ok` from their production site
- [ ] A chat on their site books (or requests a callback) and it appears under Leads with an owner and a follow-up
- [ ] Someone on their team takes a chat over and the customer sees their reply
- [ ] A voice call from the site connects, and a person can take it over (if they use voice)
- [ ] The confirmation email arrives — needs a verified sending domain (`EMAIL_FROM`)
- [ ] Their Details to collect are the ones they actually need, and show on the lead
- [ ] Each team member has signed in once

## Removing a business

`/operator/companies/<slug>` → Remove. It deletes the brand and everything under it. Export
first if they will want their data (`/app/customers` exports CSV; each conversation exports
its transcript).
