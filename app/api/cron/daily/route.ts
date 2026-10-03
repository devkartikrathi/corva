import { timingSafeEqual } from "node:crypto";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { embedPending } from "@/lib/knowledge";
import { refreshBrandProfiles } from "@/lib/crm/profile";
import { classifyEnded } from "@/lib/conversations/ending";
import { reapStaleCalls } from "@/lib/pipelines/rollup";
import { sweepRateLimits } from "@/lib/rate-limit";

/**
 * GET /api/cron/daily — the once-a-day housekeeping (vercel.json).
 *
 * Nothing customer-facing waits on it: email arrives by forwarding the moment
 * it is sent (lib/email/inbound.ts), so there is no inbox to poll. What is
 * left is tidying — closing conversations nobody is in any more, dropping
 * counters and receipts nobody will read again — and finishing any knowledge
 * still waiting for its vectors, and every customer's profile and priority
 * (lib/crm/profile.ts). The caller must present CRON_SECRET, which
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

  // Conversations that ended without being read: summary, intent, outcome.
  await classifyEnded(30).catch((e) => console.error("[cron] classify", (e as Error).message));

  // Every customer's profile and priority, from what changed today.
  let profiles = 0;
  for (const { id } of await db.select({ id: s.brands.id }).from(s.brands)) {
    if (Date.now() - started > 150_000) break;
    profiles += await refreshBrandProfiles(id).catch((e) => {
      console.error("[cron] profiles", (e as Error).message);
      return 0;
    });
  }

  const embeddings = await embedPending({ until: started + 280_000 }).catch((e) => {
    console.error("[cron] embeddings", (e as Error).message);
    return null;
  });
  return Response.json({ ok: true, profiles, embeddings });
}
