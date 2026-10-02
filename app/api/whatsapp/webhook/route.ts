import { after } from "next/server";
import { unseal } from "@/lib/data/crypto";
import { numbersIn, receive, signedBy, verifyWebhook, type WebhookBody } from "@/lib/whatsapp/cloud";

/**
 * Meta's WhatsApp webhook, for every business's connected number.
 *
 *   GET   Meta checking the address when the business saves it: the verify
 *         token must be one Corva issued, and the challenge is echoed back.
 *   POST  messages. The body is checked against the app secret of the number
 *         it names before anything is done with it; then Meta is answered at
 *         once and the customer is replied to afterwards, because Meta sends
 *         the webhook again if it waits.
 */

export const maxDuration = 120;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  if (q.get("hub.mode") === "subscribe" && (await verifyWebhook(q.get("hub.verify_token")))) {
    return new Response(q.get("hub.challenge") ?? "", { headers: { "content-type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await req.text();
  let body: WebhookBody;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const header = req.headers.get("x-hub-signature-256");
  // Only the numbers whose own app signed this are acted on.
  const numbers = (await numbersIn(body)).filter((n) => {
    try {
      return signedBy(unseal(n.appSecret), raw, header);
    } catch {
      return false;
    }
  });
  if (numbers.length === 0) return new Response("Forbidden", { status: 403 });

  after(() => receive(body, numbers));
  return new Response("OK");
}
