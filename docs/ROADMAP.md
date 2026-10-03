# What businesses will need next

Written from the business's side — an owner, their team, their developer — in the order we
expect to be asked. "Built" means in the product today.

## Built

- An assistant per business on website chat, website voice and the business's own WhatsApp
  number, answering only from the business's knowledge and inside its limits
- The business's email inbox read for its customers: threads on the customer's record, with
  which still await a reply
- The business's own database connected read-only: lookups the assistant may run for a
  customer, and questions in plain words for the team
- Attendance, and an overview of customers by channel, who answered, and each person's work
- Bookings and callbacks the customer confirms on a card; leads with owners; follow-ups with due times
- Details to collect, defined by the business, shown on live conversations and leads
- Taking over a chat or a voice call live, and handing it back
- Customers, pipeline in the business's own stage words, team performance, roles, audit log
- A public API (chat, config, leads, visits, voice), signed webhooks, an OpenAPI spec and developer docs
- Reading records back over the API — leads, customers, conversations with transcripts — filtered by
  any detail the business collects; updating a lead's stage from the business's own system
- Industry templates: clinic, real estate, retail, education, home services, laundry, restaurant, general
- Self-serve signup: an account, one form, a working assistant on a 14-day pilot
- Plans with usage metered and limits enforced; paying for a month with Razorpay; receipts
- A back office for Corva (`/admin`): every business, plans, payments, demo requests
- Asking customers to pay: the business's own payment links (Razorpay at Tumble Days), requested by
  the team or the assistant on any channel, reported back and shown where they were asked
  (`docs/PAYMENTS.md`)

## Next — what stands between a pilot and a paying business

1. **Real phone numbers** (planned in `docs/TELEPHONY.md`: WhatsApp calling on the business's own
   number, a provider number with call forwarding; SMS sending is built). A telephony provider (Exotel, Plivo or Twilio) bridged to the voice
   route, so the number on a business's signboard reaches the assistant, and a taken-over call
   can ring a team member's phone. Today voice is the website's call button only.
2. **Email that reaches customers.** A verified sending domain per business (or a shared Corva
   domain with the business's name), so confirmations do not depend on one account's test sender.
3. **Tax invoices and automatic renewal.** A GST invoice per payment, and Razorpay
   Subscriptions so a plan renews without the owner coming back each month.
4. **Production sign-in.** A Clerk production instance on the Corva domain; Organizations for
   people who belong to more than one business.
5. **Guarding self-serve.** Sign-up is open and limited per address; still to do are a check on
   disposable emails and a review queue before it is advertised widely.

## Soon — what a business asks for in its first month

6. **A drop-in chat widget.** One `<script>` tag for businesses with no developer: Corva's chat
   window and voice button, styled with their colours. Needs a publishable key and an allowed-
   origins list, because it runs in the browser.
7. **WhatsApp, the rest of it.** Answering on the business's number is built. Next: reading
   photos and voice notes, messages Corva starts (reminders, status updates, which need Meta
   templates), and a one-click sign-up in place of the six setup steps, which needs Corva to be
   approved by Meta as a Tech Provider.
7a. **Email, the rest of it.** Replying from Corva with an AI-drafted answer, sign-in with
   Google or Microsoft in place of an app password (Microsoft 365 cannot be connected today),
   and attachments.
8. **Availability and slots.** Opening hours, capacity per slot and blackout dates, so a booking
   card only offers times the business can keep. Today the assistant takes the customer's
   preferred time and the team confirms.
9. **Notifications to the team.** A handoff or a hot lead on WhatsApp or SMS, not only in the
   console and by email. (The webhook can already drive this from the business's side.)
10. **More of the API.** Follow-ups over the API (list, complete) and idempotency keys on every
    write.
9a. **Customer location, branches and distance.** A "Location" detail captured by GPS, a map
    pin, WhatsApp's "Send location" or a spoken address; the business's branches with exact
    coordinates; distance rules (discount, fee or not served) quoted by the assistant. Designed
    in `docs/LOCATION.md`, not built; Tumble Days' distance discount is the first use.
10a. **More databases.** MySQL, MongoDB and Google Sheets beside Postgres.
11. **Editing the industry template.** Stage names, what can be booked and for how far ahead,
    per business, in the console — today they come from the template.
12. **Payments.** A payment link in chat (Razorpay) for a deposit or a prepaid order, recorded
    on the lead.

## Later

- Outbound: the assistant ringing back for an overdue follow-up or a missed call
- Languages chosen per business, and a voice chosen per business
- Reports by email each morning; a simple mobile view for the person on the road
- Import of an existing customer list; export of everything
- Data residency, retention windows and deletion on request, enforced rather than stated
- A second voice provider for Indian languages (the measurements are in [VOICE.md](VOICE.md))

## Known limits today

- A voice call is bounded by the platform's function duration — five minutes on Vercel's Hobby
  plan (`VOICE_CALL_LIMIT_SECONDS`), longer on Pro.
- WhatsApp and the email inbox have been tested against stand-ins for Meta and for a mail
  server, not yet against a real number or a real inbox.
- Inboxes are read daily by Vercel's cron on the Hobby plan; the 15-minute read depends on the
  GitHub Actions schedule (or a paid Vercel plan).
- Webhook signing secrets are stored as given, not sealed like the other credentials.
- A connected database's certificate is not checked against a CA list (the connection is
  encrypted).
- A chat left idle for an hour, or a call for fifteen minutes, is closed by the scheduled job;
  the visitor's next message starts a new conversation.
- Webhook delivery is best-effort with one retry; there is no delivery log beyond the last result.
- The model provider's speed varies minute to minute; streams hedge across models, but a first
  reply after a quiet period can still take several seconds.
