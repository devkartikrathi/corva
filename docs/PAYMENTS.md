# Taking payments from customers

Built 2026-10-03, with Tumble Days (Razorpay) as the first business. Corva's own plan billing is a
different thing — see `docs/PRICING.md`.

## The idea

A customer is asked to pay wherever the business is talking to them — the console, a website
chat, WhatsApp, a call, or a driver at the door — and everyone knows the moment they have.

**The money is the business's.** Its own payment account (Razorpay for Tumble Days), its own
books. Corva never holds a payment key and never touches the money. Corva adds the *reach*: the
team and the assistant can ask from any channel, and the payment shows up on the customer's
record and in the conversation it was asked in.

```
            ask (signed)                    create link
 Corva ─────────────────────────▶ business ───────────────▶ Razorpay
  ▲  console · chat · WhatsApp ·   endpoint                    │
  │  call (Tumbly's request_payment)  │                         │ customer pays (UPI/card/…)
  │                                   │ ◀───────────────────────┘ webhook: payment_link.paid
  └───────── POST /api/v1/payments ◀──┘  (and on every other change)
```

## Corva's side (this repo)

| Piece | Where |
|---|---|
| Where a business makes links | `payment_endpoints` (one per brand: URL + signing secret) — **Settings → Payments** |
| Payments as the business reports them | `customer_payments` (brand, customer, conversation, reference, status, amounts, link, page, QR, method, order) |
| Asking the business for a link | `askForPayment` in `lib/payments/index.ts` — a signed `POST` to the endpoint (the webhook scheme, `Corva-Signature`), 15 s timeout, with a `requestId` so a retry is the same request |
| Hearing back | `POST /api/v1/payments` → `recordPayment`; `GET /api/v1/payments?reference=` / `?customerId=` |
| When it is paid | A system line in the conversation it was asked in; on WhatsApp the customer is thanked; the lead it was for moves to Converted |
| The team asking | **Request payment** on a conversation (`components/RequestPayment.tsx`, `lib/actions/payments.ts`): an amount, or an order reference; optionally posted to the customer |
| The assistant asking | Tool `request_payment({ orderReference, offerCode? })` on chat, WhatsApp, email and calls, only when the business can collect (`config.canCollect`). On a call the link goes to the caller's phone by SMS (the business's provider sends it). By default the customer proves who they are with a code first, and a person approves the request on Handoffs (`lib/payments/approvals.ts`); an offer is only attached after `check_offer` — see [PAYMENTS-AND-VERIFICATION.md](PAYMENTS-AND-VERIFICATION.md) |
| The assistant knowing | The customer's last five payments are in what it knows about them (`paymentsContext`), so "has my payment gone through?" has an answer |
| Developer docs | `/developers#payments` and the OpenAPI spec (`lib/integrations/openapi.ts`) |

Rules that are code, not prompt:

- **The assistant never names an amount.** Its tool takes an order reference only; the business
  works out what is owed. `askForPayment` refuses an amount from the assistant. A person in the
  console may type one.
- **Statuses only climb** (`failed < pending < cancelled/expired < partially_paid < paid`): a late
  or repeated report never undoes a payment.
- A business's refusal ("There is no bill on this order yet") comes back as words the assistant
  repeats to the customer.

## The business's side — Tumble Days (`../tumbledays`)

| Piece | Where |
|---|---|
| Payments ledger | `payments` table (reference `PAY-…`, order, customer snapshot, amount, paid, status, Razorpay link and payment ids, method, who asked and from where, Corva request id) and `razorpay_events` (each webhook delivery, applied once) |
| Razorpay | `src/lib/payments/razorpay.ts` — **Payment Links** over `fetch` (no SDK); signature checks ported from myfin |
| One way in for every channel | `requestPayment` in `src/lib/payments/index.ts`: the amount is typed, or the order's bill less what is paid; a pending link for the same order and amount is reused |
| Status | `applyLink`: from the webhook, the customer's signed return, or "Check with Razorpay". On paid: the order is marked paid when nothing is owed, the payment goes into the order's history, Corva is told (`POST /api/v1/payments`, and the order record's `paid`) |
| Admin | **Payments** (`/admin/payments`): totals, filters, "Request a payment"; a payment's page with the link, QR, "Send on WhatsApp", withdraw, check; **Payment** card on each order with "Collect payment" |
| Drivers | "Collect ₹… by QR" on the dispatch board for a delivery with an unpaid bill → `/admin/dispatch/pay/<id>`: a big QR that turns green when paid. Only for orders they are driving |
| Customer | `/pay/<reference>` — where Razorpay sends them back; shows amount, what for, and paid / pay now. `/pay/<reference>/qr` — the link as an SVG QR |
| Corva's endpoint | `POST /api/corva/payments` (and `GET ?reference=`), verified with `CORVA_PAYMENTS_SECRET` |

### Turning it on for Tumble Days

1. **Razorpay account** (Tumble Days' own, in its name): Dashboard → Account & Settings → API
   keys. Put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` on the `tumbledays` Vercel project. Test
   keys (`rzp_test_…`) first; the admin shows a "test mode" banner.
2. **Razorpay webhook**: Settings → Webhooks → `https://tumbledays.tiruvi.site/api/razorpay/webhook`,
   events `payment_link.paid`, `payment_link.partially_paid`, `payment_link.expired`,
   `payment_link.cancelled`; choose a secret and set it as `RAZORPAY_WEBHOOK_SECRET`.
3. **Corva**: Settings → Payments → `https://tumbledays.tiruvi.site/api/corva/payments` → copy the
   secret into `CORVA_PAYMENTS_SECRET` on the `tumbledays` project.
4. Redeploy Tumble Days (env changes need a redeploy). Ask for ₹1 from `/admin/payments` and pay it
   with Razorpay's test UPI id to see the whole loop.

Tested on 2026-10-03 with Razorpay test-mode keys, both apps on local ports and throwaway data:
the assistant asked for an order's link through Tumble Days, a signed `payment_link.paid` made
both sides paid, the conversation said so, and "has my payment gone through?" was answered.
Real money and a real Razorpay webhook delivery have not been tried.

## Other businesses

- **With their own system** (a developer, a website): build the endpoint described at
  `/developers#payments` — any payment provider — and report changes to `POST /api/v1/payments`.
  Tumble Days is the reference implementation.
- **Without one** (no developer): **Collected by Corva**, below.

## Collected by Corva

Built 2026-10-03 for businesses with no payment system of their own (`lib/payments/hosted.ts`).

- **Switched on by Corva**, per brand, at `/admin/businesses/<slug>` → *Payments collected by Corva*:
  on/off, Corva's fee (a percentage), where payouts go, and later a Razorpay Route account.
  The business sees it in Settings → Payments, with what is waiting to be paid out. A business
  with its own endpoint always uses that instead (`paymentRoute`).
- **Links are made on Corva's own Razorpay account** (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`,
  the same account as plan billing). Reference `CP-…`; the customer returns to Corva's
  `/pay/<reference>`, which records a signed return at once.
- **The amount**: a person may name one; the assistant passes an order reference and the amount is
  what the business last sent for that order (`POST /api/v1/records`, `amountRupees`) less what
  has been paid against it. No such order, or no amount on it, and the assistant says so.
- **Its own webhook**: Razorpay dashboard → Webhooks → `https://corva.tiruvi.site/api/razorpay/collect`,
  events `payment_link.paid`, `.partially_paid`, `.expired`, `.cancelled`, secret in
  `RAZORPAY_COLLECT_WEBHOOK_SECRET`. Every link carries `notes.corvaCollect`, and the plan-billing
  webhook ignores those payments, so a customer's payment is never mistaken for a plan payment.
- **The ledger**: each payment records `collected_by = 'corva'`, the fee, Razorpay's ids, and when
  and with what reference it was paid out. Admin → *Record payout* marks everything waiting as
  settled (manual bank/UPI transfer today).

**Before switching it on for a real business:**

1. **Regulation.** Collecting money on behalf of other businesses is payment aggregation, which the
   RBI regulates. Doing it on Corva's ordinary merchant account is fine for a pilot with a few
   known businesses but is not the long-term setup. The way to do it properly is **Razorpay Route**:
   each business is a *linked account* (KYC done by Razorpay), and every payment is transferred to
   it automatically, with Corva's fee kept. `routeAccountId` is stored for this; the transfer call
   is not written yet. Confirm with Razorpay that Route transfers apply to Payment Links on the
   account (via the link's order) before relying on it.
2. **Corva's terms** must say Corva collects on the business's behalf, the fee, and the payout
   schedule; the customer page already says the payment is "for <business>, through Corva".
3. **Refunds** go out of Corva's account and are not handled in the product yet.

Tested 2026-10-03 with test-mode keys and a throwaway business: the assistant made a link from an
order record, a signed `payment_link.paid` made it paid, the plan-billing webhook ignored it, ₹147
of ₹150 was owed after a 2% fee, and "did my payment go through?" was answered.

## Not yet

- Native UPI QR codes (Razorpay QR Codes API) for in-person payments; today the QR is the payment
  link, which opens Razorpay's page in any UPI app.
- Refunds, and reconciliation against Razorpay settlements.
- The website chat showing the link as a card (it is a link in the reply today).
- Sending a WhatsApp image of the QR.
