import { after } from "next/server";
import { answerEmail, takeReceived, verifyInbound } from "@/lib/email/inbound";

/**
 * POST /api/email/inbound — Resend telling us an email arrived at a
 * business's Corva address (event `email.received`).
 *
 * Signed by Resend (Svix headers, RESEND_INBOUND_SECRET); anything unsigned
 * is refused. A retried delivery is taken once. A failure answers 500 so
 * Resend tries again. When the assistant answers the business's email, it
 * does so after Resend has had its answer, so a slow reply is never retried.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!process.env.RESEND_INBOUND_SECRET) return Response.json({ error: "RESEND_INBOUND_SECRET is not set; deliveries are refused." }, { status: 503 });
  const raw = await req.text();
  if (!verifyInbound(raw, req.headers)) return Response.json({ error: "Bad signature." }, { status: 401 });

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Body is not JSON." }, { status: 400 });
  }
  if (event.type !== "email.received" || !event.data?.email_id) return Response.json({ ok: true, ignored: event.type ?? "unnamed" });

  try {
    const { answer, ...result } = await takeReceived(event.data.email_id);
    if (answer && result.conversationId) {
      const conversationId = result.conversationId;
      after(() =>
        answerEmail(conversationId, answer.body).catch((e) => console.error("[email inbound] answering", (e as Error).message)),
      );
    }
    return Response.json({ ok: true, ...result, answering: Boolean(answer) });
  } catch (e) {
    console.error("[email inbound]", (e as Error).message);
    return Response.json({ error: "Could not take the email; please retry." }, { status: 500 });
  }
}
