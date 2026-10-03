# Phone numbers, calls and SMS — the plan

Written 2026-10-03. For every business on Corva, with Tumble Days as the first. What is built
today is marked **Built**; everything else is the plan, in the order it should be done.

## What we want

A customer reaches the business **the way they already do** — the number on the signboard, the
business's WhatsApp, a text — and the same assistant answers, with the same knowledge, limits,
handoffs to a person, leads and follow-ups as on the website. Nothing about it should be specific
to one business: a clinic, a school and a laundromat set it up the same way.

Three rules shape everything below:

1. **The business keeps its number.** Customers already know it. We add to it (forwarding, WhatsApp
   calling) rather than asking a business to print a new one.
2. **One assistant, many lines.** Every channel goes through the same pipeline (`respondStream` for
   text, the voice bridge for audio). A channel is an adapter, never a second assistant.
3. **India first, not India only.** Indian telecom rules (KYC for numbers, DLT for SMS) decide the
   first build; the design leaves room for Twilio-style markets where free-form SMS and instant
   numbers are normal.

## Where we are

| Channel | State |
|---|---|
| Website chat | **Built** — `/api/v1/chat`, cards, handoffs, payments |
| Website voice (browser) | **Built** — Gemini Live through the voice bridge (`lib/voice/bridge.ts`), 16 kHz in / 24 kHz out, push-to-talk, take-the-line, pickup wait and callback (2026-10-03) |
| WhatsApp messages | **Built** — each business's own number through its own Meta app (`lib/whatsapp/cloud.ts`, `/app/whatsapp`). Tested against a local stand-in for Meta, never a real number. Shared locations and voice notes are not read yet |
| Phone numbers | Test numbers only: Corva gives each business a number and the in-app dialer routes by it (`lib/business/phone.ts`, `brandForNumber`). No real telephony |
| SMS | Not built. Razorpay sends payment links by SMS itself (its own sender) |
| Email | **Built** — forwarded to the business's Corva address, received through Resend; replies from Corva |

## Part 1 — Calls

### Three ways a call can reach the assistant

**A. WhatsApp calling on the business's existing WhatsApp number** *(recommended first for calls)*

Meta's Cloud API **Calling** lets a customer tap "call" on a business's WhatsApp profile or in the
chat. User-initiated calls are generally available wherever the Cloud API is, India included; they
are free (over data), need no DLT registration and no phone-line KYC.

- **How it works:** Meta sends a `calls` webhook with an SDP *offer* (WebRTC). We answer through
  the Graph API with an SDP *answer*; audio then flows as WebRTC (Opus, 48 kHz) between the
  customer's WhatsApp and our media endpoint. We decode it to PCM, feed Gemini Live (16 kHz), and
  encode Live's 24 kHz reply back to Opus.
- **What we build:**
  1. Turn on calling for the number (Meta's call settings API) from `/app/whatsapp`.
  2. A WebRTC endpoint beside the voice bridge. Options: `werift` (pure TypeScript, runs in our
     Node bridge) or a small Pion (Go) sidecar. It must run where long-lived UDP works — **not**
     a Vercel function; the bridge's current host already has to hold WebSockets, but WebRTC
     needs UDP, so this is the point where the voice bridge moves to a small always-on server
     (Fly.io / Railway / a VM in Mumbai).
  3. An adapter: WhatsApp call ↔ the existing bridge session (`openVoiceConversation`, tools,
     handoffs, transcripts all unchanged). Caller identity is the WhatsApp number, so the customer
     is recognised by phone the way calls already are.
  4. Handing over to a person: the person joins from the console's call screen, as today (the
     relay already mixes a person's audio into a live call).
- **Limits:** only customers who use WhatsApp; business-initiated calls need the customer's
  permission first; Meta's calling terms and per-number quotas apply.

**B. A real phone number (PSTN) through a telephony provider**

For callers who dial a number. The provider gives a number, answers the call, and streams the
audio to us over a WebSocket.

| Provider | Fit |
|---|---|
| **Exotel** | India-first; the *Voicebot* applet streams both ways over WSS (PCM16, 8/16/24 kHz in; PCM/PCMU back in ~100 ms frames). Numbers need business KYC |
| **Plivo** | Audio Streams over WebSocket; India local numbers ~₹250/month, inbound ~₹0.60/min with streaming (2026 pricing); KYC: certificate of incorporation + GST |
| Twilio | Media Streams (8 kHz μ-law); best outside India; Indian numbers are hard to get |

- **What we build:** one `TelephonyProvider` interface (answer, stream, transfer, hang up) with an
  Exotel or Plivo adapter first; resampling 8 kHz ↔ 16 kHz in and 24 kHz → 8 kHz out; a
  `business_numbers` table (below) so `brandForNumber` routes real numbers exactly as it routes the
  test ones; the provider's webhook for call start/end.
- **Handing over to a person:** on a phone line the natural way is a *transfer* — the provider dials
  the colleague's own mobile and bridges them in. The pickup wait and callback fallback built on
  2026-10-03 apply unchanged: ring, wait a minute, else promise a callback.
- **Cost to pass on:** number rent + per-minute; Corva's plans already meter voice minutes.

**C. Keeping the business's existing number — call forwarding**

Most small businesses will not change the number on their board. Their mobile or landline forwards
to the Corva number from option B:

| Forward | GSM code (most Indian operators) |
|---|---|
| Every call | `**21*<corva number>#` |
| When busy | `**67*<corva number>#` |
| When not answered | `**61*<corva number>#` |
| When unreachable | `**62*<corva number>#` |
| Cancel all | `##002#` |

"When not answered" is the sweet spot: the team picks up when they can, and the assistant catches
every call they miss. **To verify per operator before promising it:** that the original caller's
number reaches us on a forwarded call (it usually does, but some operators pass the forwarding
number), and what the operator charges the business for forwarding.

### The calls build, in order

1. **Telephony adapter + one provider (Exotel or Plivo)** behind `TelephonyProvider`; real numbers in
   `business_numbers`; Tumble Days on a test number; forwarding guide in the console.
2. **Move the voice bridge to an always-on host** (it already runs as `npm run voice`), keeping
   `/api/voice` on Vercel for the browser if WebSockets there stay reliable.
3. **WhatsApp calling** (WebRTC) on the business's existing WhatsApp number.
4. **Outbound calls**: the assistant calling back a customer it promised to (follow-ups), with consent
   and calling-hours rules (TRAI: no promotional calls to DND numbers; service calls only).

## Part 2 — SMS

### What SMS can and cannot be in India

- Every sender must be registered on the **DLT** platform (TRAI): the business as an *entity*, a
  6-character *header* (sender id, e.g. `TMBLDY`), and **every message as a template** with
  `{#var#}` placeholders. Since 2025 variables are typed and headers carry a category suffix
  (`-T` transactional/service, `-P` promotional, …).
- So the assistant **cannot write free-form SMS** to Indian numbers: only approved templates go out.
- Two-way SMS is not part of ordinary A2P in India; receiving needs a virtual mobile number (VMN),
  and replies still go out as templates.

**Therefore:** in India, SMS is for **notifications**, and conversations happen on WhatsApp. Where
free-form SMS is allowed (most other countries, through Twilio), the same adapter can carry
two-way conversations later — the `sms` conversation channel already exists in the schema.

### What SMS is for, first

| Purpose | Example template (DLT) |
|---|---|
| Payment link | `Dear {#var#}, pay {#var#} for {#var#} at {#var#} - {#var#}` |
| Booking confirmed | `Your {#var#} with {#var#} is confirmed for {#var#}. Ref {#var#}` |
| Callback arranged | `{#var#} will call you back shortly about {#var#}. - {#var#}` |
| Missed call | `Sorry we missed your call. Chat with us on WhatsApp: {#var#} - {#var#}` |
| Order update | `Your order {#var#} is {#var#}. - {#var#}` |

### Whose registration — two models

1. **The business's own** (recommended for any business that sends SMS at volume): it registers
   on DLT, gets its header and templates approved, and gives Corva its SMS provider credentials
   (stored sealed, like database passwords). Messages come from *its* name.
2. **Corva's** (for small businesses, pilots): Corva registers as an entity with one header and a
   set of generic templates where the business's name is a variable. Simpler, but every message
   says it is from Corva's header, and DLT scrutinises templates that send on behalf of others —
   confirm with the provider before relying on it.

### Providers

**MSG91** (India, DLT-native, "Flow" API that takes a DLT template id and variables), Exotel SMS,
Fast2SMS for India; **Twilio** for everywhere else. One `SmsProvider` interface; a `log` provider
that sends nothing for development and testing.

### The SMS build, in order

1. **Built 2026-10-03** (`lib/sms/index.ts`, Settings → SMS): per business a provider (`log` test
   mode, MSG91, Twilio), sender id, DLT entity, sealed credentials; a template per purpose with
   its DLT and MSG91 ids; a log of every message (`sms_messages`); "Send a test". First uses: the
   customer is texted when a callback is arranged because nobody could take their call, and staff
   can tick "Also by SMS" when requesting a payment. Tested with the providers' HTTP calls caught
   in-process (exact MSG91 Flow and Twilio requests checked) — never against a real account.
2. Tumble Days registers on DLT (entity, header, the templates above) and buys MSG91 credit.
3. More automatic uses: missed calls (with Part 1), order updates from `POST /api/v1/records`.
4. Delivery reports (provider webhooks) and STOP / opt-out handling per number.

## Part 3 — Numbers as data

One table for every number a business is reachable on, so routing, the console and billing read
one place:

```
business_numbers
  id, brand_id
  e164            "+911244567890"
  kind            "pstn" | "whatsapp" | "sms_vmn" | "test"
  provider        "exotel" | "plivo" | "twilio" | "meta" | "corva-test"
  capabilities    { voice, sms, whatsapp }
  forwarded_from  the business's own number, when calls are forwarded to this one
  provider_ref    the provider's id for the number / app
  status, created_at
```

`brandForNumber` (today: `brands.phone_number`, test numbers) moves to this table; WhatsApp's
`whatsapp_numbers` stays as it is and is linked by `e164`.

## Costs at a glance (India, 2026, list prices — confirm when signing up)

| Item | Approx. |
|---|---|
| WhatsApp user-initiated call | ₹0 to the business (data) |
| Phone number rent (Plivo) | ₹250 / month |
| Inbound minute incl. streaming (Plivo) | ₹0.60 |
| Gemini Live audio | per Google's Live API pricing; already metered in `lib/pricing.ts` |
| Transactional SMS (MSG91 and similar) | ~₹0.15–0.25 each |
| DLT registration | one-time fee per entity on the operator's portal |

## Decisions needed

1. **Telephony provider for India:** Exotel or Plivo (both stream audio; compare KYC speed and
   support). Tumble Days' KYC documents (certificate of incorporation, GST) for its number.
2. **Forwarding:** will Tumble Days forward its existing number on *no answer*, or on every call?
3. **WhatsApp:** what is not working with Tumble Days' WhatsApp today, before calling is added on
   top (Corva's WhatsApp has only been tested against a stand-in for Meta).
4. **SMS registration:** Tumble Days' own DLT entity and header (recommended), or Corva's.
5. **Hosting the voice bridge** on an always-on server, which WhatsApp calling (UDP) requires.

## Sources (researched 2026-10-03)

- Meta, WhatsApp Cloud API calling — https://developers.facebook.com/documentation/business-messaging/whatsapp/calling
- WhatsApp Business Calling API in India — https://chakrahq.com/article/whatsapp-cloud-api-calling-feature-details/amp/
- Exotel stream & voicebot applet — https://developer.exotel.com/docs/agentstream/stream-voicebot-applet
- Plivo audio streaming — https://plivo.com/docs/voice-agents/audio-streaming/concepts/audio-streaming-guide
- Plivo India voice pricing — https://www.plivo.com/voice/pricing/in/
- DLT rules (2025 amendments, template variables) — https://www.enablex.io/insights/a-step-by-step-guide-to-dlt-registration/
- India SMS guidelines — https://www.messagecentral.com/en-in/sms-guideline/india
