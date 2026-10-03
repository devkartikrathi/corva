# One customer, every channel — identity and profiles

Written 2026-10-03. For every business on Corva; Tumble Days is the first. **Built** marks what
exists; the rest is the plan.

## The problem

A person reaches a business in many ways: the website chat, a web voice call, a phone call,
WhatsApp, an email. Each arrives with a different handle — a browser, a number, an address, an
order reference — and until now each could become a different "customer":

- Kartik chats on Tumble Days' site and gives his number. Next session, same browser, Tumbly asks
  for his number again: nothing tied the browser to the customer it had learned.
- He emails about the same order: a third record, "Kartik", with only his email.
- Worse, the old rule "a phone number decides who someone is" **merged and deleted** the record a
  conversation started as when the person gave a known number — throwing away that record's email,
  and (through `ON DELETE CASCADE`) its mirrored orders. And an email typed next to someone else's
  number became that customer's "email on file", the address `email_details` sends order details
  to.

So the job has two halves: **know that it is the same person** (safely), and **understand that
person the way this kind of business needs to** (profiles).

## Part 1 — Identity

### What identifies a person

| Handle | Where it comes from | Can we trust it? |
|---|---|---|
| Phone | a call's caller id; WhatsApp; typed or said | **Verified** on a real call and WhatsApp; **stated** when typed or said |
| Email | an email's From; typed or said | **Verified** when they wrote from it; **stated** otherwise |
| Browser | the site's visitor cookie (`td_vid`) | the same *browser* — only as trusted as whatever was learned in it |
| Order reference | said or typed; a business system's record | **evidence**, never identity — a husband asks about his wife's order |
| Business system | the business's own records API (`customer.id/phone/email`) | **verified** — the business knows its customers |
| The team | a person confirms or merges | **verified** |

A claim is not proof. Anyone can type a number. So Corva keeps **every** number and email a
customer has been seen with (`customer_identities`), and marks each one **verified** or
**stated**. A browser is kept on the visitor (`visitors.customer_id`): one browser, the person
last identified in it.

### The rules

1. **The same handle is the same customer.** A number, an address or a browser already on a
   customer resolves to them, on any channel.
2. **An anonymous conversation that learns a handle joins that customer.** A chat that starts with
   nobody and is told "8384007473" becomes Kartik's conversation — the team sees one timeline.
   The browser is linked to him, so next time the chat (and a web voice call) **starts as Kartik**
   and does not ask again.
3. **A record made a moment ago, with nothing of its own, folds in.** "Kartik" typed into a fresh
   chat makes a name-only stand-in; when the number then matches, the stand-in is merged into the
   customer (everything moves, nothing is lost).
4. **Two real customers are never merged on a claim.** When a conversation that already belongs to
   one customer is given a handle (or asks about an order) that belongs to another, Corva records
   a **match** — "possibly the same person", with the evidence — on both records. The team merges
   it with one click, or marks it "not the same". An attacker who types a victim's number cannot
   pull the victim's history into their own conversation, or their address onto the victim.
5. **A stated handle never becomes the address on file.** `customers.phone` / `customers.email`
   (what `email_details`, SMS and callbacks use) are filled only from verified handles, from the
   business's own records, or for a customer created in this same conversation. Anything else is
   kept as a stated handle the team can confirm.
6. **The assistant knows how sure we are.** A conversation is marked with how it was identified
   (`conversations.identified_by`: caller id, WhatsApp, email, business, browser, stated, team). On
   a stated identity the assistant greets the person by name and uses what they say, but does not
   read out what is on the record (address, past orders, payments) — details go by email to the
   address on file, as before.

### Merging

`mergeCustomers(from, into)` moves everything — conversations, leads, follow-ups, records,
payments, SMS, notes, consents, visitors, handles — onto `into`, fills `into`'s gaps (name, phone,
email, location, first seen), keeps the earlier "customer since", writes an audit row with a copy
of the record that went (`customer_merges`), and removes `from`. One statement batch, so it either
all happens or none of it does. Handles that moved because of a claim stay **stated** on the new
customer.

### Matches worth suggesting

| Evidence | Suggested because |
|---|---|
| A customer's conversation gives a number or email that belongs to another customer | they say it is theirs |
| A customer asks about an order that belongs to another customer | it might be theirs — or a family member's |
| (later) Same name and the same address | weak alone; shown with the rest |

### Later

- **Proving a stated handle**: "We've sent a code to r•••@gmail.com" / a WhatsApp "is this you?"
  — a stated identity becomes verified without the team.
- Real phone lines (Part 1 of `docs/TELEPHONY.md`): caller id is verified on the network.

## Part 2 — Profiles

A profile is what the business needs to know about a customer, **computed** from everything on
the record — never typed in. The numbers are the same for every business; which ones matter, and
what they mean, depend on the kind of business.

### Measured for everyone (`customers.profile`)

- **Contact**: first seen, last contact, contacts in 30 / 90 days, by channel, the channel they
  use most, the timeline across channels.
- **Orders** (records of kind order / booking, from the business's system): how many, first and
  last, total and average value, the usual gap between orders (median), days since the last one,
  whether they are **overdue** (past 1.5× their usual gap), and whether they are ordering **more
  or less often** than they used to.
- **Value**: lifetime value from their orders, or from payments collected through Corva.
- **Issues**: escalations in 90 days, open follow-ups and leads, sentiment of recent contacts.
- **Where they are**: a pickup or home address that reads like a hotel, PG, hostel, guest house
  or rental stay ("OYO", "Airbnb", "serviced apartment", "staying for 3 days") marks them
  **short stay**.

### What it means, by kind of business

| Business | Model | Segments (first that fits) | What raises priority |
|---|---|---|---|
| Laundry, retail, home services, general | **Repeat purchase** | Short stay · Regular (3+ orders, usual gap ≤ 3 weeks) · Lapsing (overdue) · New (0–1 orders) · Occasional | lifetime value, lapsing, open issues, unhappy contacts |
| Education / coaching | **High-touch pipeline** | Enrolled (won or paid) · Considering (open lead) · Enquiry | an open lead going quiet (needs follow-ups before enrolling); after enrolling, issues only |
| Clinic | **Appointments** | Due for recall (no visit in 6 months) · Returning · New patient | recall due, open issues |
| Real estate | **Pipeline** | Active buyer (open lead) · Past client · Enquiry | an open lead going quiet, value |

The segment is written to `customers.segment` with the reason ("Lapsing — usually every 9 days,
last order 23 days ago"), and the numbers feed the existing priority engine as signals
(`customer_signals`: value, churn risk, engagement, escalations, sentiment) with weights per kind
of business, so the **Blended priority** on the customer page finally has real inputs.

The assistant gets one line of it ("Regular customer: 7 orders, usually every 9 days; last 4 days
ago; mostly WhatsApp"). What a business *does* with a segment — no first-order discount for a short
stay, a win-back voucher for someone lapsing — is the business's policy, written into its
assistant's instructions and offers (Tumble Days: next).

### When it is computed

On every identification and merge, when the business sends a record, when a payment lands, the
first time the assistant reads a stale profile (over an hour old), and nightly for everyone.

## Built (2026-10-03)

- `customer_identities`, `customer_matches`, `customer_merges`; `conversations.visitor_id`,
  `conversations.identified_by`; `customers.profile`, `customers.profile_at` (`lib/crm/identity.ts`,
  `lib/crm/profile.ts`).
- Every way a customer is found goes through the handle table: callers, WhatsApp, inbound email,
  the records API, the chat's and the call's saved details, the transcript read after a call.
- Browser → customer: a chat or web voice call from a browser that was identified before starts as
  that customer.
- Email replies go to the address the customer wrote from, not whatever is on file.
- Customer page: every handle with verified / stated, the profile, possible matches with Merge /
  Not the same, and merging another record in by its number or email.
