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

The business connects the inbox its customers write to. Corva reads new mail and:

1. drops anything automated (mailing lists, no-reply senders) and mail from the business's own
   domain;
2. asks the AI, once per new thread, whether it is from a customer;
3. for a customer's message, finds or creates the customer by email address and records the
   thread as a conversation on the `email` channel, with a one-line summary;
4. adds the business's replies, read from its Sent folder, to the thread, and marks it replied.

A thread with no reply shows as **Awaiting a reply**. If the customer writes again it goes back
to awaiting.

What is not from a customer is not stored: not the text, not the sender. Corva only reads. It
never sends, moves, flags or deletes mail; replying still happens in the business's mail app.

### Connecting

IMAP over TLS on port 993, with the mailbox password or an app password (sealed with
`DATA_SOURCE_KEY`).

| Provider | Server | Note |
|---|---|---|
| Gmail / Google Workspace | `imap.gmail.com` | Needs 2-Step Verification and an app password |
| Zoho Mail | `imap.zoho.in` or `imap.zoho.com` | Turn on IMAP; use an app-specific password |
| Titan | `imap.titan.email` | The mailbox's own password |
| Hostinger | `imap.hostinger.com` | The mailbox's own password |
| Yahoo | `imap.mail.yahoo.com` | App password |
| Other | the provider's IMAP server | Must accept TLS on 993 |

Microsoft 365 and Outlook.com no longer accept passwords over IMAP; they need sign-in with
Microsoft, which is not built yet.

### When mail is read

- On connecting: the last 14 days, 40 messages at most.
- On a schedule: `GET /api/cron/inbox` reads every inbox not read in the last ten minutes. It
  needs `Authorization: Bearer $CRON_SECRET`.
  - Vercel's cron (`vercel.json`) calls it once a day, which is all the Hobby plan allows.
  - `.github/workflows/read-inboxes.yml` calls it every 15 minutes, using the repository secret
    `CRON_SECRET`. GitHub may run a schedule late, and pauses it after 60 days without a commit.
  - On a paid Vercel plan, set the schedule in `vercel.json` to `*/15 * * * *` and drop the workflow.
- Whenever the Email or Overview screen is opened and the last read is over five minutes old.
- On **Check now**.

### Not yet

Replying from Corva, an AI-drafted reply, sign-in with Google or Microsoft instead of an app
password, and attachments.

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
