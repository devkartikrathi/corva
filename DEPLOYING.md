# Deploying Corva to Vercel

Corva is one Next.js app. On Vercel it serves the public site (`/`, `/demo`), self-serve
signup (`/sign-up`, `/welcome`), a business's console (`/app`), Corva's back office (`/admin`),
the public API (`/api/v1/*`), the developer docs (`/developers`), the payment routes
(`/api/razorpay/*`) and the voice bridge (`/api/voice`, a WebSocket) — no second server to run.

## 1. Import the project

1. Vercel → **Add New… → Project** → import the repository (branch `main`).
2. Framework: **Next.js** (detected). Leave build and output settings as they are.
3. Add the environment variables below before the first deploy.

Fluid Compute must be on (the default for new projects) — the voice bridge holds WebSockets
open with it.

## 2. Environment variables

Settings → Environment Variables. `.env.example` has the same list with notes.

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon **pooled** connection string |
| `DATABASE_URL_UNPOOLED` | yes | Neon **direct** connection string — migrations, and the live relay when a person takes over a voice call |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Gemini API key: chat, embeddings and voice |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk publishable key (step 3) |
| `CLERK_SECRET_KEY` | yes | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | yes | `/sign-up` |
| `APP_URL` | recommended | The public address, e.g. `https://corva.example.com` — used in emails, the docs and the voice address |
| `VOICE_TOKEN_SECRET` | recommended | A long random string: `openssl rand -base64 32` |
| `RESEND_API_KEY` | recommended | From Resend (step 4). Without it emails are logged, not sent |
| `EMAIL_FROM` | once a domain is verified | e.g. `Corva <hello@your-domain.com>` |
| `CORVA_ADMIN_EMAILS` | yes | Comma-separated emails that may open `/admin` and receive demo requests |
| `DATA_SOURCE_KEY` | to connect databases | Any long random string (`openssl rand -base64 36`). Seals the connection strings businesses give Corva. Changing it means every business reconnects |
| `RAZORPAY_KEY_ID` | to take payment | From Razorpay → Account & Settings → API Keys (`rzp_test_…` or `rzp_live_…`) |
| `RAZORPAY_KEY_SECRET` | to take payment | Shown once, when the key is generated |
| `RAZORPAY_WEBHOOK_SECRET` | to take payment | A string you choose when creating the webhook (step 6) — **not** the key secret |

Do **not** set `CORVA_DEMO` on Vercel. It is ignored on the production deployment anyway:
sign-in is always required there.

Without the Razorpay keys everything else works: Billing shows the plans and says online
payment is not switched on, and plans are set from `/admin`.

## 3. Clerk (sign-in)

- **To try the deployment** — the *development* keys (`pk_test_…` / `sk_test_…`) work on any
  domain, with a "development mode" badge and a user cap.
- **For real businesses** — create a **production instance** in Clerk for your domain, add the
  DNS records it lists, and use its `pk_live_…` / `sk_live_…` keys. Keep **Email address**
  enabled with **verification** on: Corva only trusts verified emails when it binds an
  invitation or an Owner seat.

Users in the development instance do not carry over to production.

## 4. Email (Resend)

Vercel → the project → **Integrations → Marketplace → Resend**. That sets `RESEND_API_KEY`.
Until a sending domain is verified in Resend, emails only reach the Resend account's own
address; once it is, set `EMAIL_FROM` to an address on it and redeploy. Customer confirmations
and lead notifications depend on this.

## 5. Payments (Razorpay)

1. Razorpay dashboard → **Account & Settings → API Keys** → generate a key. Set
   `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` on the project. Use test keys first: checkout
   then takes Razorpay's test cards and no money moves.
2. **Settings → Webhooks → Add** — URL `https://<corva>/api/razorpay/webhook`, a secret of your
   choosing, events `payment.captured`, `payment.failed` and `refund.processed`. Set the same
   secret as `RAZORPAY_WEBHOOK_SECRET`.
3. Redeploy. `/api/status` shows `payments` and `paymentsWebhook` true.

A business pays a month at a time from **Billing**. The amount is worked out on the server
(plan + any overage owed + 18% GST); the plan changes once the payment's signature verifies,
and the webhook does the same if the payer closed the tab. Without the webhook secret,
deliveries are refused and only the in-browser path grants a plan.

## 6. Domain

Settings → Domains → add the domain, add the DNS record Vercel shows, then set `APP_URL` to it
and redeploy.

## 7. Database

One Neon database (with the `vector` extension).

- A fresh database: `npm run db:migrate`.
- A schema change: `npm run db:generate` writes a migration; run `npm run db:migrate` **before**
  deploying the code that needs it. Keep migrations additive so the running version keeps working.
- The `db:seed*` scripts build a fictional demo workspace. Never run them on the database real
  businesses live in.

Local development uses the same database unless you point `.env.local` elsewhere.

## 8. Check it

Open **`https://<corva>/api/status`**. It answers yes/no for every piece — never a value — and
lists anything required that is `missing`:

```json
{ "ok": true, "mode": { "demo": false },
  "voiceUrl": "wss://corva.example.com/api/voice", "missing": [] }
```

Also: `/app` redirects to sign-in, `/admin` opens for an admin email and is a 404 for anyone
else, `/developers` and `/demo` load.

## 9. A business, and its website

A business signs itself up at `/sign-up` and sets itself up at `/welcome`; you can also add one
at `/admin/new`. [docs/ONBOARDING.md](docs/ONBOARDING.md) has both paths. To connect its site:

1. In its console, **Settings → Website & API keys** → make a key. Its site's server gets two
   variables, and nothing else:

   | Variable | Value |
   | --- | --- |
   | `CORVA_API_URL` | your Corva address, no trailing slash |
   | `CORVA_API_KEY` | the `ck_…` key |

2. Check: `curl -H "Authorization: Bearer ck_…" https://<corva>/api/v1/health` — `ok: true`,
   and `features.voice` / `voiceSecure` true if they will use voice.
3. Optional: **Settings → Webhooks** — their URL, and the signing secret into their server as
   `CORVA_WEBHOOK_SECRET`.

Their developer works from `/developers`.

## 10. Test the whole loop

On the business's site:

- Chat with the assistant; ask for a booking or a callback; tap **Confirm** on the card →
  Corva: **Leads** (with the details collected), **Follow-ups**, the customer's record, and the
  confirmation email.
- Open **Live** in Corva during a chat, **take the line**, reply → it appears in the site's chat
  under your name.
- Press the site's call button and talk → the call is on **Live**; take the line → the assistant
  says it is transferring the caller, and you speak to them from the call panel.

From the business's own console, **Try it** rings or chats to the assistant as a customer —
free, and kept out of the numbers.

Sign up with a fresh email → `/welcome` → the pilot → **Billing** → pay with a Razorpay test
card → the plan changes, and the payment is in `/admin/payments`.

## Voice: how it runs, limits, and plan B

`app/api/voice/route.ts` upgrades the request to a WebSocket and the call runs in
`lib/voice/bridge.ts`. Every call needs a signed token.

- An unattended call with the assistant is capped at `VOICE_SESSION_CAP_SECONDS` (180).
- A call a person has taken over may run to `VOICE_CALL_LIMIT_SECONDS` in all — 290 by default,
  because a function on Vercel's Hobby plan lives five minutes. On Pro, raise `maxDuration` in
  `app/api/voice/route.ts` (up to 800) and set `VOICE_CALL_LIMIT_SECONDS` to just under it.
- Audio between a caller and the person who took the call travels through Postgres
  (`LISTEN/NOTIFY`), which needs `DATABASE_URL_UNPOOLED`.

If WebSocket upgrades are ever unavailable, run the same bridge anywhere that keeps a Node
process alive — `npm run voice` with the same `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
`GOOGLE_GENERATIVE_AI_API_KEY` and `VOICE_TOKEN_SECRET`, plus `VOICE_REQUIRE_TOKEN=1` — and set
`VOICE_BRIDGE_PUBLIC_URL=wss://…` on the Corva project.

## When something is wrong

| Symptom | Look at |
| --- | --- |
| `/admin` is a 404 for you | Your verified email is not in `CORVA_ADMIN_EMAILS` (redeploy after changing it) |
| A business's assistant has stopped answering | Its pilot or plan ended, or the pilot's allowance is used — `/admin` shows which; extend it there |
| A payment was taken but the plan did not change | `/admin/payments` shows it as "not applied": check `RAZORPAY_WEBHOOK_SECRET` and the webhook's deliveries in Razorpay, then set the plan by hand |
| No demo request emails | `RESEND_API_KEY` / `CORVA_ADMIN_EMAILS`; the requests are still in `/admin/demo-requests` |
| The site's voice button does not appear | `/api/v1/health`: `features.voice` / `voiceSecure`; the site's `CORVA_API_KEY` |
| A call connects and the assistant never answers, or the line drops | The conversation's last turn in Corva says why the model closed; `docs/VOICE.md` §10 |
| Chat replies take many seconds | The model provider is slow; streams hedge after `MODEL_HEDGE_MS`. Check `/app/tuning` → model |
| No emails | `RESEND_API_KEY`, and a verified domain for `EMAIL_FROM` |
| A webhook stopped arriving | Settings → Webhooks shows the last delivery's result; **Send test** |
