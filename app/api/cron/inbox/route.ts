import { eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { syncMailbox } from "@/lib/email/mailbox";

/**
 * GET /api/cron/inbox — read every connected inbox that is due.
 *
 * Called on a schedule (vercel.json). Without it an inbox is only read when
 * someone opens a screen, so a customer who writes on a quiet day would wait
 * to be seen. The caller must present CRON_SECRET, which Vercel sends for its
 * own cron jobs.
 */

export const maxDuration = 300;

/** An inbox read more recently than this is left alone. */
const DUE_MS = 10 * 60_000;
/** Stop starting new inboxes after this long; the rest are picked up next time. */
const BUDGET_MS = 240_000;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Not authorised." }, { status: 401 });

  const started = Date.now();
  const due = await db
    .select({ brandId: s.brands.id, name: s.brands.name })
    .from(s.mailboxes)
    .innerJoin(s.brands, eq(s.brands.id, s.mailboxes.brandId))
    .where(or(isNull(s.mailboxes.lastSyncedAt), lt(s.mailboxes.lastSyncedAt, new Date(started - DUE_MS))))
    // Longest unread first, so one slow inbox cannot starve the others for ever.
    .orderBy(s.mailboxes.lastSyncedAt);

  let read = 0;
  let kept = 0;
  let failed = 0;
  for (const box of due) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      const result = await syncMailbox({ id: box.brandId, name: box.name });
      if (result) {
        read++;
        kept += result.kept;
      }
    } catch (e) {
      // The reason is on the mailbox row for its owner; the run carries on.
      failed++;
      console.error("[cron inbox]", box.name, (e as Error).message);
    }
  }
  return Response.json({ due: due.length, read, kept, failed });
}
