# Deploying Corva to Vercel

Corva is one Next.js app. On Vercel it serves the business console (`/app`),
the public API (`/api/v1/*`) for websites like Tumble Days, the developer docs
(`/developers`), and the voice bridge (`/api/voice`, a WebSocket) — no second
server to run.

Corva's own console (`/operator` — onboarding businesses, test calls) is **not**
part of the deployment: it runs on the Corva team's machines with `npm run dev`,
against the same database, and returns 404 on Vercel.

## 1. Import the project

1. Vercel → **Add New… → Project** → import `devkartikrathi/corva` (branch `main`).
2. Framework: **Next.js** (detected). Leave build and output settings as they are.
3. Before the first deploy, add the environment variables below, then deploy.

Fluid Compute must be on (the default for new projects) — the voice bridge
relies on it to hold WebSockets.

## 2. Environment variables

Settings → Environment Variables. `.env.example` has the same list with notes.

| Variable | Required | Value |
| --- | --- | --- |
| `DATABASE_URL` | yes | Neon **pooled** connection string (the one you use locally works — same database) |
| `DATABASE_URL_UNPOOLED` | yes | Neon **direct** connection string (migrations) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | yes | Gemini API key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | yes | Clerk publishable key (see step 3) |
| `CLERK_SECRET_KEY` | yes | Clerk secret key |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | yes | `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | yes | `/sign-up` |
| `APP_URL` | recommended | `https://corva.tiruvi.site` (or the `…vercel.app` address until the domain is set) |
| `VOICE_TOKEN_SECRET` | recommended | A long random string: `openssl rand -base64 32` |
| `RESEND_API_KEY` | recommended | From the Resend integration (step 4) |
| `EMAIL_FROM` | once a domain is verified | e.g. `Tumble Days <hello@tumbledays.com>` |

Do **not** set `CORVA_DEMO` or `CORVA_OPERATOR_OPEN` on Vercel. (They are
ignored on the production deployment anyway: sign-in is always required there,
and `/operator` does not exist.)

## 3. Clerk (sign-in)

Two options:

- **Quick test** — use your existing *development* keys (`pk_test_…` /
  `sk_test_…`). Sign-in works on any domain, with a small "development mode"
  badge. Fine for trying the deployment.
- **Production** — Clerk dashboard → create a **production instance** for
  your domain (`tiruvi.site`), add the DNS records it lists, then use its
  `pk_live_…` / `sk_live_…` keys. Keep **Email address** enabled with
  **verification** on (the default): Corva only trusts verified emails when it
  binds an invitation or a staff account.

Users in the development instance do not carry over to production — you sign
up once more there.

## 4. Email (Resend)

Vercel → your project → **Integrations → Browse Marketplace → Resend** → add it
to the project. That sets `RESEND_API_KEY`. Until you verify a sending domain
in Resend, emails only reach your own Resend account address; once the domain
is verified, set `EMAIL_FROM` with an address on it and redeploy.

## 5. Domain

Settings → Domains → add `corva.tiruvi.site` (Vercel shows the DNS record to
add). Then set `APP_URL=https://corva.tiruvi.site` and redeploy — it is the
address used in emails, the docs, and for voice (`wss://corva.tiruvi.site/api/voice`).

## 6. Check it

Open **`https://<your-corva>/api/status`**. It answers yes/no for every piece
(never a secret's value) and lists anything required that is `missing`:

```json
{ "ok": true, "mode": { "demo": false, "operatorOpen": false },
  "voiceUrl": "wss://corva.tiruvi.site/api/voice", "missing": [] }
```

## 7. First sign-in

Businesses are added from the operator console on your own machine
(`npm run dev` → `http://localhost:3000/operator/onboarding`). The Owner's
email you enter there is who can sign in to that business on the live site:

1. On the live site, `/sign-up` (or `/sign-in` if the account exists) with that
   email, and verify it.
2. `/app` opens that business's console. For Tumble Days the Owner is
   `devkartikrathi@gmail.com`.

## 8. Connect Tumble Days (or any website)

1. In Corva, `/app` → **Settings → Website & API keys → Make a key**. Copy it.
2. In the **Tumble Days** Vercel project → Environment Variables:

   | Variable | Value |
   | --- | --- |
   | `CORVA_API_URL` | `https://corva.tiruvi.site` (your Corva address, no trailing slash) |
   | `CORVA_API_KEY` | the `ck_…` key |
   | `GEMINI_API_KEY` | as before (Tumbly's own chat model) |

3. Redeploy Tumble Days. Check with
   `curl -H "Authorization: Bearer ck_…" https://<corva>/api/v1/health` —
   `features.voice` and `features.voiceSecure` should both be `true`, and the
   phone button appears in Tumbly's chat.

Any other business's developer follows `/developers`.

## 9. Test the whole loop

- On tumbledays.tiruvi.site: accept cookies, chat with Tumbly, request a
  callback with your email → Corva: **Leads**, **Follow-ups**, the customer's
  record ("On the website"), and a confirmation email.
- Press the phone button and talk → Corva **Live calls** shows the call in the
  "Live now" strip while it happens; take the line and Tumbly goes quiet.
- From your local operator console (`/operator/testing`), dial the business's
  test number or chat as a customer.

## Voice: how it runs, and plan B

On Vercel the bridge is `app/api/voice/route.ts`: the request is upgraded to a
WebSocket (`experimental_upgradeWebSocket` from `@vercel/functions`) and the
call runs in `lib/voice/bridge.ts`. Calls are capped at 180 seconds, inside a
function's five minutes; every call needs a signed token.

If the WebSocket upgrade is ever unavailable on your plan or region (the call
screen says it cannot reach the bridge), run the same bridge anywhere that
keeps a Node process alive — Railway, Render, Fly — with `npm run voice`, the
same `DATABASE_URL`, `GOOGLE_GENERATIVE_AI_API_KEY` and `VOICE_TOKEN_SECRET`,
plus `VOICE_REQUIRE_TOKEN=1`; then set `VOICE_BRIDGE_PUBLIC_URL=wss://…` on the
Corva project.

## Database

The production app uses the same Neon database you develop against, already
migrated. For a fresh database: `npm run db:migrate`, then `npm run db:seed`
for the demo workspace, then `scripts/setup-tumbledays.ts <owner-email>`.
