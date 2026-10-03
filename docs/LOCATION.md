# Customer location, branches and distance

**Status: designed, not built.** Researched on 2026-10-03 for Tumble Days, written for every
business. Nothing in this document exists in the product yet; it records what was found and
decided so it can be built without re-deriving it. Open decisions are listed at the end.

## What it is for

A business wants to know **where the customer is**, the way it already knows their name, phone
and email — and then to do something with it:

- **Tumble Days (the first use):** take the customer's pickup location, find the nearest
  store, measure the distance, and quote a distance-based discount (or say the area is not
  served).
- **Any business:** a clinic finds the nearest branch; a restaurant checks its delivery
  radius; a home-services business checks whether the address is inside its service area; a
  school tells a parent which campus is closest.

So it is built as three general things, not a Tumble Days feature:

1. **A "Location" detail to collect** — a new kind in *Details to collect*, beside Phone and
   Email. Any business can switch it on and make it required.
2. **Branches** — each business's own locations, with exact coordinates.
3. **Distance rules** — bands of distance from the nearest branch, each with an effect: a
   discount, a fee, or "not served".

## How it works, end to end

1. The assistant needs the customer's location (the field is on the business's list, or the
   customer asked about distance, delivery or a discount).
2. It asks for it in the way the channel allows (see *Capture per channel*):
   - **website chat:** a card with "Use my current location" (GPS) and a map with a draggable
     pin;
   - **WhatsApp:** the native "Send location" button;
   - **call / email:** the address in words, looked up on the map.
3. Corva stores the pin: latitude, longitude, accuracy, how it was captured, and a readable
   address.
4. **Code, not the model,** finds the nearest branch, measures the distance, and picks the
   matching distance rule.
5. The assistant is handed a finished sentence — *"The customer is 3.2 km from Tumble Days
   Sector 56. Rule: 2–5 km → 10% off pickup orders."* — and quotes it. It never computes a
   distance or a discount itself (the same rule as catalog prices: see `docs/ARCHITECTURE.md`,
   *Products & services*).
6. The team sees the pin on the conversation, the lead and the customer record, with a map
   link, the nearest branch and the distance.

## What exists today (and where this plugs in)

| Piece | Where | Relevance |
|---|---|---|
| Field kinds | `lib/business/intake.ts` — `FIELD_KINDS = ["text","phone","email","address","choice","date","number"]` | Add `"location"`. `address` (free text) already exists and stays. |
| Captured details | `conversations.captured` — `jsonb` typed `Record<string,string>` (`lib/db/schema.ts`) | A location is structured, so it cannot be a bare string (see *Data model*). |
| Details also on the lead | `leads.details` jsonb, written by `captureDetails` | Same structured value. |
| Customer's place | `customers.location` (text) — filled from an `address` field by `captureDetails` | Add coordinates beside it. |
| Cards in chat | `lib/agent/proposals.ts` — `Proposal` kinds `booking` / `callback`; streamed as the `proposal` event by `/api/v1/chat`; confirmed at `/api/v1/chat/confirm` | The location card reuses this pattern as a new event. |
| Tumble Days chat UI | `../tumbledays/src/components/chat/useCorvaChat.ts` (reads `delta` / `proposal` / `done` events), `ActionCard.tsx` (renders a booking/callback card), `src/app/api/chat/confirm/route.ts` (server-side proxy to Corva) | The location card is a sibling of `ActionCard`, with its own proxy route. |
| WhatsApp inbound | `lib/whatsapp/cloud.ts` — `UNREADABLE` maps `location: "a location"`, so a shared pin is currently answered with "I cannot open that" | Read `m.location` instead. |
| WhatsApp outbound | `lib/whatsapp/cloud.ts` — `send(number, to, message)` posts any Graph message body | Send the interactive location request through it. |
| Consent | `customer_consents` table (kind, granted, detail, capturedAt) | Record location consent here. |
| Agent tools | `lib/agent/respond.ts` (text channels), `lib/voice/session.ts` (calls) | One new tool on each, plus prompt lines. |
| Public API docs | `lib/integrations/openapi.ts` → `/developers` and `/api/v1/openapi.json` | Must be updated with every API change (project rule). |

## Data model (proposed)

### The captured value

A location detail is stored as an object, not a string:

```ts
type CapturedLocation = {
  lat: number;            // WGS84, 6 decimal places (~0.1 m)
  lng: number;
  accuracyM: number | null;   // from the browser / phone; null when typed or spoken
  source: "gps" | "pin" | "whatsapp" | "geocoded";
  address: string | null;     // reverse-geocoded (pin) or as given (typed/spoken)
  at: string;                 // ISO time captured
};
```

`conversations.captured` and `leads.details` are typed `Record<string, string>` today. Two
options, decide at build time:

- **(preferred)** widen the type to `Record<string, string | CapturedLocation>` and teach
  every reader (`knownDetails`, `DetailsPanel`, CSV export, webhooks, API) to print a location
  as its address plus a map link;
- or keep strings and store `captured[key] = "<address>"` with the coordinates in a separate
  `conversation_locations` table. Simpler for readers, one more join.

### Customer

Add to `customers`: `latitude double precision`, `longitude double precision`,
`location_accuracy_m integer`, `location_source text`, `location_at timestamptz`.
`customers.location` (text) keeps the readable address. The latest pin wins, but only if it is
more precise or newer than the one on file (a GPS fix replaces a geocoded guess, not the other
way round).

### Branches

```
brand_branches
  id uuid pk
  brand_id uuid → brands (cascade)
  name text                -- "Tumble Days Sector 56"
  address text
  latitude double precision not null
  longitude double precision not null
  service_radius_km real   -- null = no limit
  active boolean default true
  position integer
  created_at, updated_at
```

### Distance rules

```
distance_rules
  id uuid pk
  brand_id uuid → brands (cascade)
  from_km real not null    -- inclusive
  to_km real               -- exclusive; null = and beyond
  effect text not null     -- "discount_percent" | "fee" | "not_served" | "note"
  value integer            -- percent, or paise for a fee
  label text not null      -- what the assistant may say: "10% off pickup orders"
  applies_to text          -- optional: a catalog group/item id, or null for everything
  position integer
```

Bands must not overlap (checked on save). A distance outside every band means "no rule": the
assistant says nothing about distance pricing.

### Nearest branch and distance (code)

```ts
// Great-circle distance in km (haversine). Good to a few metres at city scale.
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371.0088;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
```

`distanceCheck(brandId, point)` → `{ branch, km, rule, served, sentence }`. The nearest
*active* branch; `served` is false when beyond that branch's radius or when the rule says
`not_served`. Distances are rounded to one decimal for speech, but the band is chosen on the
unrounded value.

## Capture per channel

### Website chat (Corva's own chat and any brand site, Tumble Days first)

1. The assistant calls a new tool `ask_location({ reason })` (web chat only). The stream emits
   a new event:

   ```
   event: location_request
   data: { "id": "<request id>", "field": "<field key>", "reason": "To find your nearest store and any distance discount" }
   ```

2. The site shows a **location card**:
   - **"Use my current location"** → `navigator.geolocation.getCurrentPosition` with
     `{ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }`. Needs HTTPS (both
     sites are) and the browser's permission prompt. Returns lat/lng and `coords.accuracy`
     in metres.
   - **A map with a draggable pin**, centred on the GPS fix if allowed, otherwise on the
     business's city; a search box (place autocomplete) to jump to an area. The customer can
     correct the pin — GPS on a laptop is often hundreds of metres off, and the pickup point
     may not be where they are standing.
   - **"Type an address instead"** for anyone who will not share.
   - One line under it saying why, and that it is only used for this order (consent).

3. The site's server posts the pin to Corva (never straight from the browser, so the API key
   stays server-side — the same pattern as `/api/chat/confirm`):

   ```
   POST /api/v1/chat/location
   { "sessionId": "...", "requestId": "...", "lat": 28.41, "lng": 77.04, "accuracyM": 18,
     "source": "gps" | "pin", "consent": true }
   ```

   Corva reverse-geocodes to an address, stores the value, records consent, runs the distance
   check, and returns the assistant's next reply (as `/chat/confirm` does), e.g. *"You're 3.2 km
   from our Sector 56 store, so your pickup gets 10% off."*

4. The Tumble Days site needs: a `LocationCard` component beside `ActionCard`, handling the
   `location_request` event in `useCorvaChat.ts`, and `src/app/api/chat/location/route.ts`.
   Corva's own Try-it chat (`components/ChatTester.tsx`) gets the same card.

### WhatsApp

- **Ask:** send an interactive **location request message** — the customer sees a
  "Send location" button that opens WhatsApp's own location picker (current location or a
  dropped pin). Body:

  ```json
  { "messaging_product": "whatsapp", "recipient_type": "individual", "to": "<number>",
    "type": "interactive",
    "interactive": { "type": "location_request_message",
                     "body": { "text": "Please share your pickup location so we can find your nearest store." },
                     "action": { "name": "send_location" } } }
  ```

  Only inside the 24-hour customer-service window (always true mid-conversation).
- **Receive:** inbound messages of `type: "location"` carry
  `location: { latitude, longitude, name?, address? }`. Replace the "cannot open" reply in
  `lib/whatsapp/cloud.ts` with: store it (`source: "whatsapp"`), run the distance check, and
  hand the result to the assistant as the turn's input.
- Sharing a location in WhatsApp is itself the customer's explicit act; record consent with
  `detail: "shared on WhatsApp"`.

### Calls

A caller cannot drop a pin. The assistant asks for the area and a landmark ("Which sector, and
what's near you?"), Corva geocodes the words (biased to the business's city), and the
assistant reads back what it found ("Near Sector 56 market, Gurugram — is that right?"). The
value is stored with `source: "geocoded"` and treated as approximate: the distance is quoted
as "about", and a band edge within ~500 m is mentioned as "around". Later: after the call,
send the WhatsApp location request to the caller's number to get an exact pin.

### Email

The written address is geocoded the same way, `source: "geocoded"`.

## Looking addresses up (geocoding) and the map

Three jobs need a map provider: **the map in the card**, **reverse geocoding** (pin → readable
address for staff) and **forward geocoding** (typed or spoken address → pin). GPS itself is the
browser's and costs nothing. Distance is computed in code and costs nothing.

| Provider | Strengths | Free allowance (as researched, 2026) | Notes |
|---|---|---|---|
| **Google Maps Platform** (recommended) | Best Indian address and landmark data; Places autocomplete for the search box | India pricing: Essentials SKUs (Dynamic Maps, Geocoding) **70,000 calls/month each free**; Pro 35,000; Enterprise 7,000 | Needs a Maps API key on a billing account. Restrict the browser key by HTTP referrer (the brand's domain, Corva's domain) and to the Maps JavaScript API; a separate server key, restricted by API, for geocoding. |
| **Ola Maps** | India-focused, cheaper | **500,000 calls/month free** across services; then ~$0.015/call for geocoding | Good fallback or cost option. |
| Leaflet + OpenStreetMap tiles + Nominatim | Free, no account | Public Nominatim is limited to 1 request/second and forbids heavy use | Weak Indian address data; would need a hosted tile/geocode provider in production. |

At pilot volumes every option is free. Build it behind one module (`lib/geo/`) with
`geocode(text, near)`, `reverseGeocode(point)` and the browser map loaded from a config value, so
the provider can change without touching the channels. Env vars (names to fix at build):
`GOOGLE_MAPS_BROWSER_KEY` (sent to the site/widget), `GOOGLE_MAPS_SERVER_KEY` (server only).

## Straight-line vs road distance

Straight-line (haversine) is free, instant and stable — good for discount bands. In Indian
cities the road distance is typically **30–40% longer**. Either:

- set the bands knowing they are straight-line (simplest; recommended to start), or
- for a customer within ~500 m of a band edge, ask a routes API (Google Routes / Distance
  Matrix, Ola Routing) for the driving distance and use that. Costs a call only at the edges.

Whichever is used, the assistant and the console say which ("3.2 km away, as the crow flies").

## How the assistant uses it

- **Details to collect:** a `location` field is asked for like any other, but the instruction
  says *how*: on website chat call `ask_location`; on WhatsApp the request button is sent; on a
  call or email, ask for the area and a landmark. It is never asked as "please type your
  latitude".
- **When it is not on the list,** the assistant may still ask if the customer asks about
  delivery, distance, the nearest branch or a distance discount, and the business has branches.
- **What it is told** after a location arrives — one deterministic sentence from
  `distanceCheck`, e.g. *"Customer is 3.2 km (straight line) from Tumble Days Sector 56.
  Rule: 2–5 km → 10% off pickup orders."* or *"Customer is 11.4 km from the nearest store
  (Sector 56); beyond the 8 km service area — say it is outside the area we serve and offer a
  callback."*
- **Never** computes a distance or discount, never quotes a discount that is not a rule, and
  never states coordinates aloud.
- **Stacking with other offers** follows the business's setting (open decision below); the
  sentence it is given already says whether the distance discount combines with others.
- **Tools:** `ask_location` (web chat), `check_distance({ address })` for a typed or spoken
  address (geocode → distance check), on both `lib/agent/respond.ts` and `lib/voice/session.ts`.

## In the console

- **Settings → Branches & distance:** add branches (name, address, a map to place the pin
  exactly, radius); add distance rules as bands with a live check ("try an address").
- **Details to collect:** "Location (map pin)" as a kind.
- **Conversation, lead and customer:** the address, a small static map or an "Open in Google
  Maps" link (`https://www.google.com/maps?q=<lat>,<lng>`), the nearest branch, the distance,
  the rule applied, and how it was captured (GPS ±18 m / pin / WhatsApp / from address).
- **Products & services:** the outline the assistant reads gains the distance rules, so "do
  you have discounts?" can mention them.

## API and webhooks

- `GET /api/v1/config` — the location field appears with `kind: "location"`, and the
  business's branches (name, address, coordinates) so a site can show them.
- Chat stream — new `location_request` event.
- `POST /api/v1/chat/location` — new.
- Leads, customers and conversations (API and webhooks) — the location value and the distance
  result included.
- Update `lib/integrations/openapi.ts`, `/developers`, `docs/INTEGRATION.md`.

## Privacy and consent

Location is personal data under India's **Digital Personal Data Protection Act, 2023**:

- Ask before using GPS, with the purpose in one line; the browser's own prompt follows.
- Store only the pin needed for the order — no continuous tracking, no location history.
- Record consent in `customer_consents` (`kind: "location"`, how it was given).
- Show it only to the business's own team; include it in a customer's data export and delete
  it with the customer.
- Never send coordinates to the model's prompt beyond what is needed (the sentence it is
  given contains the distance and branch, not the raw coordinates).

## Edge cases

- **GPS refused or unavailable** → map pin or typed address; never block the order on it.
- **Low accuracy** (laptop Wi-Fi, > 200 m) → show the accuracy circle and ask to confirm or
  drag the pin; treat the band as approximate near an edge.
- **Ordering for somewhere else** (at the office, pickup from home) → the card asks for the
  *pickup* location, not "where are you", and the pin can be moved anywhere.
- **Several addresses for one customer** (home, office) → the latest confirmed one is on the
  customer record; each order's location stays on its own conversation and lead.
- **Exactly on a band edge** → the band is chosen on the unrounded distance; `from_km` is
  inclusive.
- **No branches configured** → the field still records the location; there is no distance
  sentence.
- **Outside India / wrong city** → geocoding is biased to the business's city; a pin far from
  every branch is "not served" if a radius is set.
- **Spoofed location** → a discount is a promise, not a payment; the business confirms the
  address at pickup, as today.

## Build order

1. **Corva core**
   - `"location"` field kind; structured captured value; customer coordinate columns
     (migration, additive).
   - `brand_branches`, `distance_rules` (migration, additive) and the Settings screen.
   - `lib/geo/` (haversine, nearest branch, distance check, geocoding behind one interface).
   - Assistant: prompt lines and `check_distance` on text and voice; `ask_location` on web chat.
   - WhatsApp: send the location request; read inbound locations.
   - Corva's own chat: the location card and `POST /api/v1/chat/location`.
   - Console: location on conversation, lead, customer; branches and rules in Settings.
   - Docs: this file becomes the description of what was built; OpenAPI and `/developers`.
2. **Tumble Days site** — `LocationCard`, the `location_request` event in `useCorvaChat.ts`,
   the `/api/chat/location` proxy route.
3. **Later** — driving distance at band edges; WhatsApp location request after a call; showing
   branches on the brand site from `/api/v1/config`.

## Testing

- Unit: haversine against known pairs; band selection at edges (inclusive/exclusive);
  nearest-branch with several branches; radius → not served.
- Channel: a web-chat conversation through the card (GPS and dragged pin); a WhatsApp
  inbound `location` message (local stand-in for Meta's API, as WhatsApp is tested today); a
  synthesized-speech call giving a sector and landmark (the method used to test handoffs on
  2026-10-03: macOS `say` → `afconvert` 16 kHz PCM → the bridge on a spare port).
- The assistant never quotes a distance or discount that did not come from `distanceCheck`.
- Use a throwaway business; never write test locations into Tumble Days.

## Decisions needed before building

1. **Tumble Days' stores** — name, address and exact latitude/longitude for each.
2. **Tumble Days' bands** — distances and effects (e.g. 0–2 km 15% off, 2–5 km 10%, 5–8 km
   no discount, beyond 8 km not served), and what they apply to (pickup orders only? per-kg
   laundry too?).
3. **Stacking** — does a distance discount combine with the volume discounts (20% / 30%) and
   the ₹10,000 package (30%), or is the best single offer applied?
4. **Map provider** — Google Maps (recommended; needs an API key on a billing account) or Ola
   Maps.
5. **Straight-line or driving distance** for the bands.

## Sources (researched 2026-10-03)

- Google Maps Platform India pricing — https://mapsplatform.google.com/intl/en_in/pricing/
- Google: helping developers in India — https://blog.google/intl/en-in/products/explore-communicate/helping-developers-in-india-build-more-with-google-maps-platform/
- Ola Maps pricing — https://maps.olakrutrim.com/pricing
- WhatsApp location request messages — https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/location-request-messages/
