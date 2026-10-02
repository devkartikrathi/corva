# Integrating a business's website with Corva

The full, always-current reference is the live page **`/developers`** and the spec at
**`/api/v1/openapi.json`** — both generated from `lib/integrations/openapi.ts`. This document
is the shape of an integration and the standard we hold one to. It applies to every business;
the Tumble Days site (`../tumbledays`) is the worked example.

## The contract

- Two settings on the site's **server**: `CORVA_API_URL`, `CORVA_API_KEY`. The key never
  reaches the browser. That is the entire configuration.
- The site owns its look: the chat window, the cards, the call screen. Corva owns the
  assistant, the knowledge, the bookings, the team's work and the emails.
- Nothing about the business is hard-coded in the site. The assistant's name, the booking word
  and the fields come from `GET /config`.

## What the site builds

| Piece | Calls | Notes |
| --- | --- | --- |
| A chat route on its server | `POST /chat` (`stream: true`) | Adds the key and the visitor id; passes the event stream through. Its own per-IP rate limit in front. |
| A chat window | — | Shows `delta`s as they arrive; a typing indicator until the first one. |
| A booking / callback card | `POST /chat/confirm` | From `proposal`: `details`, plus `extra`. Confirm and Edit. Input locked until one is tapped. |
| Takeover | `GET /chat` | Poll every ~8 s while a chat is open, ~3 s once `heldBy` is set. Show the person's name. |
| A voice button (optional) | `POST /voice-sessions` + WebSocket | Hidden unless `features.voice` (and `voiceSecure` on https). Push-to-talk. |
| Visitor tracking (optional) | `POST /visits` | A first-party visitor-id cookie; the consent the banner recorded. |
| Its own forms (optional) | `POST /leads` | Build the form from `fields`; send answers as `details`. |
| A webhook receiver (optional) | — | Verifies `Corva-Signature`; idempotent on `id`. |

## The reference implementation

In `../tumbledays`:

| File | What it shows |
| --- | --- |
| `src/lib/corva.ts` | The server-side client: JSON calls with one retry, and a raw call for streams |
| `src/app/api/chat/route.ts` | The chat proxy: validation, per-IP limit, visitor cookie, stream pass-through, takeover poll |
| `src/app/api/chat/confirm/route.ts` | Confirm / Edit |
| `src/components/chat/useCorvaChat.ts` | Reading the event stream, card state, takeover polling |
| `src/components/chat/ActionCard.tsx` | The confirmation card, including `extra` |
| `src/app/api/voice-token/route.ts`, `src/components/chat/VoiceCall.tsx` | A voice call, iPhone-safe, with a person taking over |
| `src/proxy.ts`, `src/lib/visitor.ts`, `src/app/api/visit/route.ts` | The visitor cookie and consent |

## What we check before an integration goes live

1. The key is server-side only; `/health` is `ok` from production.
2. `/config` is read, not copied — rename a field in Corva and the site follows.
3. One `sessionId` per chat; `visitorId` on every call.
4. A card that fails to confirm shows Corva's `error` (a `409` or `422` is a real answer).
5. A person taking over is visible in the chat within a few seconds.
6. The voice button only appears when a call can actually connect.
7. The site has its own rate limit: the key's 120 requests a minute are shared by all its visitors.
8. Webhook deliveries are verified and safe to receive twice.

## Changing the API

- `v1` only grows: new optional fields, new event types. Never rename or remove within `v1`.
- Describe the change in `lib/integrations/openapi.ts` in the same commit — the docs and spec
  are that file.
- Examples stay business-neutral.
