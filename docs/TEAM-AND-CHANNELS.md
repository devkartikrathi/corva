# Customers on every channel, and the team serving them

Corva is a customer and employee management system for any kind of business. It does not manage
orders or jobs: those live in the business's own system. What it shows is who the customers are,
how they reached the business, who answered them, and who was at work.

## Overview (`/app/overview`)

One screen, read differently down the pyramid.

| Who is looking | What they see |
|---|---|
| Owner, admin, manager, analyst | Every channel and every person |
| Anyone else | The same customer picture, and their own line of work |

- **Headline:** customers (and new ones in the period), conversations, the share answered by the
  AI, the share answered by people, and how many of the team are at work now.
- **Who answered, day by day:** a column per day, split into AI, people, and email still awaiting a
  reply.
- **How customers reached you:** a bar per channel (phone, website chat, email), split the same way.
- **The team:** per person, calls taken, chats taken, handoffs picked up, follow-ups done, leads
  won, days in and hours at work.

The period is 7, 14 or 30 days. Everything is counted from conversations, handoffs, follow-ups,
leads and attendance, so a number here never disagrees with the screen it came from. Seeing the
whole team side by side follows the plan's team-management feature, like Performance.

## Attendance (`/app/attendance`)

- Everyone starts and ends their own day with one button. Starting also makes them available
  for handoffs; ending takes them out of the queue.
- An owner or admin can record a day for anyone: present, half day, on leave, absent. A mark
  never erases the times the person clocked. Each mark is in the audit log.
- The week is a grid, a person a row, with the hours for each day and the week.
- A day still open today counts up to now, 14 hours at most. A past day that was never ended
  counts no hours.
- Days are India calendar days.

## When a customer asks for a person

`lib/crm/callback.ts`, used by calls (`lib/voice/session.ts`, `lib/voice/bridge.ts`) and by chat,
WhatsApp and email (`lib/agent/respond.ts`).

- The assistant first checks whether anyone who may take customers is marked **Available**.
- **Someone is:** they are rung (the alert in the console), and on a call the assistant says it is
  connecting the caller and it may take a minute, using the wait to collect anything the team still
  needs. If nobody takes the line within `VOICE_PICKUP_WAIT_SECONDS` (default 60), it tells the
  caller the team will call them back as soon as possible, confirms the number, and asks for an
  email.
- **Nobody is:** no transfer is promised. The assistant says the team will get back to them and
  asks for the best number and an email. On chat it keeps the conversation to take them.
- Either way a callback follow-up is written — "Call back <name>: asked for a person, nobody was
  free" — due in 15 minutes, for whoever was being rung or otherwise the usual owner. The alert
  stays open while a caller is still on the line, so a colleague who frees up can still join; once
  they have gone it is closed as "Nobody was free — callback arranged".

## Who the customer is

Whenever the assistant records a name, number or email — chat's details, a call's saved details —
the conversation is attached to a customer: found by phone number, or created
(`identifyCustomer` in `lib/crm/capture.ts`). On a call the model sometimes forgets to save them,
so when a person is being brought in and again when the call ends, the transcript is read once
more and what the caller said about themselves is recorded (`lib/crm/identify.ts`).

## Email (`/app/email`)

Customer email arrives by **forwarding** (since 2026-10-03; IMAP inbox reading was removed). See
`lib/email/inbound.ts`.

- **Each business has a Corva address** (`<name>-<code>@RESEND_INBOUND_DOMAIN`), shown with a copy
  button on the Email screen. The business forwards customer mail to it — every message, a filter
  (recommended: only customers' mail, so nothing else ever leaves their inbox), or one message at a
  time with *Forward*. Gmail, Workspace, Outlook and every other provider can forward.
- **Gmail's confirmation**: Gmail sends a code to the new address before it allows forwarding. Corva
  catches that email and shows the code (and link) on the Email screen; it never confirms on its own.
- **Instant**: Resend receives the mail and calls `POST /api/email/inbound` (event `email.received`,
  signed — `RESEND_INBOUND_SECRET`). Corva fetches the message, finds the business by the address it
  was delivered to (`received_for`), and sorts it as before: a customer's email becomes a thread on
  their record (the customer is made if new); newsletters, receipts and colleagues are dropped.
  A message forwarded by hand is unwrapped so the customer, not the business, is the sender. A
  delivery made twice is taken once (`email_messages`).
- **Replying from Corva**: *Reply* on a thread sends the answer through Resend in the business's
  name. The email says it is the business's reply to the customer's message ("…'s reply to your
  message 'Pickup timing'") because it comes from Corva's sending address, and its Reply-To is the
  business's Corva address — so the customer's answer comes straight back onto the same thread.
- **Setup on Corva's side**: in Resend, turn on receiving (its `<id>.resend.app` domain, or a custom
  domain with an MX record), set `RESEND_INBOUND_DOMAIN` to that domain, add a webhook for
  `email.received` pointed at `https://<corva>/api/email/inbound`, and set its signing secret as
  `RESEND_INBOUND_SECRET`. Replies from the business's own domain need that domain verified in
  Resend (`EMAIL_FROM`).
- **Some things only go by email** (`lib/email/details.ts`). Anyone can say an order reference on a
  call or in a chat, so the assistant tells anyone where an order has got to — and nothing more.
  Asked for the bill, the items, the address, the payment or the driver, it offers to email them and
  calls `email_details`: they go only to the email address the business has on file for that order's
  customer (never one given in the conversation), and the caller hears only a masked address
  ("r•••@gmail.com"). Recorded on the conversation's actions.
- The old `mailboxes` table is unused and can be dropped once this version is live everywhere.

### Not yet

- Attachments (photos of a stain, a receipt) are not kept — the text is.
- The assistant does not answer email itself; the team does, from Corva.

## WhatsApp (`/app/whatsapp`)

The business connects its own number through Meta's WhatsApp Cloud API. There is no reseller:
the business owns the Meta app and the number, and pays Meta. From then on:

- a message to the number is answered by the business's assistant exactly as a website chat is:
  the same knowledge, the same details to collect, the same plan metering (it counts as a chat);
- a booking or callback to confirm arrives as the details with **Confirm** and **Change** buttons;
- the chat lands in Conversations on the `whatsapp` channel, on the customer found or created
  from the sender's number, with their WhatsApp profile name;
- when a person takes the chat over in the console, what they type is sent to the customer's
  WhatsApp. If it cannot be delivered the reply is refused, not silently recorded;
- a photo, voice note or document cannot be read yet: the assistant says so and asks for text.

Corva only replies to a customer who wrote first, inside WhatsApp's 24-hour window. It does not
start conversations, so no message templates are needed. A chat quiet for 24 hours is over; the
next message starts a new conversation.

### Connecting

The business needs a Meta Business account and a number not in use on the WhatsApp phone app.

1. At developers.facebook.com, create a Business app and add the WhatsApp product.
2. WhatsApp → API Setup: add the number; copy its **Phone number ID**.
3. Business settings → System users: create one, assign it the app and the WhatsApp account,
   and generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`.
   This is the permanent **access token**.
4. App settings → Basic: copy the **App secret**.
5. Paste the three into Corva. It checks them with Meta and seals the token and secret with
   `DATA_SOURCE_KEY`.
6. Corva shows a **Callback URL** (`/api/whatsapp/webhook`) and a **Verify token**. In the Meta
   app: WhatsApp → Configuration → Webhook → Edit, paste both, Verify and save, then subscribe
   to the `messages` field.

Until the app is published (Live mode) Meta only delivers messages from numbers added as testers.

### How a webhook is trusted

Every POST is checked against `X-Hub-Signature-256` using the app secret of the number it names;
anything else gets 403. Meta is answered immediately and the customer is replied to afterwards.
Each message id is handled once, however many times Meta delivers it.

### Environment

| Variable | Default | |
|---|---|---|
| `WHATSAPP_GRAPH_VERSION` | `v23.0` | Graph API version to call |
| `WHATSAPP_GRAPH_URL` | `https://graph.facebook.com` | Only for testing against a stand-in |

### Not yet

Reading photos and voice notes, starting a conversation (templates, reminders, status
messages), several numbers per business, and a one-click sign-up in place of the six steps
(that needs Corva itself to be approved by Meta as a Tech Provider).
