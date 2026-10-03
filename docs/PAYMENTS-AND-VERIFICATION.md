# Leads, payments, offers, verification and SMS

Written 2026-10-03. For every business on Corva, not only Tumble Days. **Built** marks what is
in the code; the rest is the plan.

## Where a conversation can start

A customer starts one on the website (chat or voice), by phone, on WhatsApp or by email. From
the console, a person on the team can start one only where it reaches the customer:

| Channel | What "Open a conversation" does |
|---|---|
| **Phone** | Shows the number to ring (a `tel:` link on a phone) and logs the call with its notes. Corva has no outbound line yet (`docs/TELEPHONY.md`). |
| **WhatsApp** | Inside 24 hours of the customer's last message, opens the chat for the person to type into. Outside it, WhatsApp only lets a business write first with a **template Meta has approved**: the business names one on the WhatsApp screen and Corva sends it, and the chat opens when they reply. |
| **Email** | A new email from the business, Reply-To its Corva address, so the answer comes back to the same thread. |

Web chat cannot be opened from the console (nobody is on the website to receive it), and SMS is
never a conversation (below). **Built.**

## SMS is for notifications only

No assistant ever chats over SMS, and no person does either. SMS carries short, approved
(DLT) messages that tell the customer something happened:

- **Verification codes** (below) — the first real use.
- Payment links, booking confirmations, callbacks arranged, order updates.
- Later: the customer chooses what they want by SMS (prices, ticket updates…).

**Built:** an `otp` template purpose; the code itself is never written into the SMS log.

## The leads board

Five stages, the same for every business:

| Stage | Who moves it there | When |
|---|---|---|
| **New** | the assistant | the person tells us who they are (a name, a number, an address) — a lead exists from then on. It **stays New** when they hesitate, ask for a person, or a callback is arranged: a person picks it up from here |
| **Contacted** | the assistant, or a person | the assistant settled what they asked for (they confirmed a booking or a request on the card), or a person spoke to them |
| **Processing** | a person, or the business's system | something is under way: a pickup placed, an order being worked on |
| **Converted** | Corva, or a person | they **paid** (a payment marked paid converts the lead), or the business's system says it is done |
| **Lost** | **a person only** | they decide there is no getting this one back. Nothing about the customer is deleted |

`qualified` (older rows, older integrations) counts as Processing. **Built.**

## Taking payment

The assistant has never been allowed to **name an amount**: it asks for an order's payment by
its reference, and the amount comes from the business's own system (or the order Corva holds).
That is enforced in code, not in the prompt. On top of that, two switches per business
(Setup → Payments), both **on** by default:

1. **A person approves each payment link the assistant asks for.** The assistant tells the
   customer the team will send the link; the request waits on the Handoffs screen with the order,
   the customer, how sure we are who they are, and any offer. *Approve & send* makes the link and
   sends it where the conversation is (WhatsApp, the chat, the email thread) and through the
   business's system's own SMS/email. *Decline* tells the customer the team will be in touch.
   Off: the assistant makes the link itself, as before.
2. **The customer proves who they are first.** On a conversation that is not already verified
   (a WhatsApp number, a real call's caller id, an email they wrote from, the business's own
   record), the assistant first sends a code (below) and only asks for the payment once it is
   entered.

## Offers and discounts

The risk: a customer talks the assistant into a number ("my friend got 50% off"), or a prompt
injection makes it invent one. The answer is that **the model never decides a discount**:

- A business publishes **offers** (Setup → Offers): a code, what it gives (a % with a cap, or a
  flat amount), a minimum order, dates, first order only, once per customer, and customer
  segments it does not apply to (e.g. **Short stay** — see `docs/CUSTOMER-PROFILES.md`).
- The assistant knows only the active offers, by code. When a customer mentions one, it calls
  `check_offer`: **code** checks dates, segment, first order, once per customer. Only a valid
  offer can be attached to a payment request, and the payment's amount — with the offer applied —
  is worked out by the business's system or by Corva in code, never by the model.
- Anything else — "can you do it cheaper", a code that is not published, a goodwill gesture —
  is refused politely and offered to the team (the existing authority rules: discounts are
  blocked for the assistant and escalate to a manager).
- With approval on, a person sees the offer on the request before any link exists.

**Built:** offers, `check_offer`, offers on payment requests and approvals, one use per customer
recorded. *Next:* Tumble Days' payment endpoint applying `offer` from Corva's request (it
receives it; it does not apply it yet).

## Verifying a customer (codes)

For every business. A code proves the person in the conversation controls the number or email
**on file** for the customer they say they are.

- `send_verification_code` sends a 6-digit code by **SMS** (the business's `otp` template) or
  **email**, only to the number or email already on the customer's record — never to one typed
  in the conversation. The assistant is told only where it went ("r•••@gmail.com").
- `verify_code` checks what the customer typed. The code is never shown to the model: it is
  stored hashed (HMAC), lasts 10 minutes, allows 5 tries, and at most 3 codes are sent per
  conversation an hour and 6 per number or email a day.
- A right code makes the conversation **verified** (`identified_by = "otp"`): the assistant may
  now discuss the record and take payment, and the handle is marked verified on the customer.
- The "never accept OTPs" rule is about bank and payment-app codes; the assistant's
  instructions say so, so it does not refuse its own code.

**Built** for email (works today through Resend) and SMS (once the business's SMS provider and
DLT `otp` template are set up; in test mode the message is logged without the code).

## Later

- Restricting other actions behind a code (changing an address, cancelling an order).
- The customer choosing which updates they get by SMS.
- Turning approval off per business once the team trusts it — the switch exists.
