import { timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { embedPending } from "@/lib/knowledge";
import { reapStaleCalls } from "@/lib/pipelines/rollup";
import { sweepRateLimits } from "@/lib/rate-limit";

/**
 * GET /api/cron/daily — the once-a-day housekeeping (vercel.json).
 *
 * Nothing customer-facing waits on it: email arrives by forwarding the moment
 * it is sent (lib/email/inbound.ts), so there is no inbox to poll. What is
 * left is tidying — closing conversations nobody is in any more, dropping
 * counters and receipts nobody will read again — and finishing any knowledge
 * still waiting for its vectors. The caller must present CRON_SECRET, which
 * Vercel sends for its own cron jobs.
 */

export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET is not configured." }, { status: 503 });
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Not authorised." }, { status: 401 });

  const started = Date.now();
  await Promise.all([
    sweepRateLimits(),
    // Conversations nobody is in any more: without this they stay "live" for ever.
    reapStaleCalls(),
    db.delete(s.whatsappSeen).where(lt(s.whatsappSeen.at, new Date(Date.now() - 7 * 86_400_000))),
  ]).catch((e) => console.error("[cron] sweep", (e as Error).message));

  const embeddings = await embedPending({ until: started + 280_000 }).catch((e) => {
    console.error("[cron] embeddings", (e as Error).message);
    return null;
  });
  return Response.json({ ok: true, embeddings });
}
