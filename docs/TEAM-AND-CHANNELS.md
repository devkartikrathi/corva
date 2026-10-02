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

On connecting (the last 14 days, 40 messages at most), then whenever the Email or Overview screen
is opened and the last read is more than five minutes old, and on **Check now**. There is no
scheduled read yet, so an inbox nobody looks at is not read.

### Not yet

Replying from Corva, an AI-drafted reply, sign-in with Google or Microsoft instead of an app
password, a scheduled read, WhatsApp and SMS, and attachments.
