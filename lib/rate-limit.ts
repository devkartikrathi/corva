import { lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Rate limits that hold across instances.
 *
 * A counter in memory limits one server process, and on a platform that runs
 * many short-lived ones that is a limit nobody ever reaches. These are counted
 * in the database: one row per key per window, incremented atomically.
 *
 * Everything that costs money per call and can be reached by someone who is
 * not signed in goes through here — a chat turn, a WhatsApp message, the demo
 * form — as do the expensive things a signed-in person could loop on.
 *
 * If the database cannot be reached the call is allowed: a limiter that fails
 * closed turns its own outage into everybody's.
 */
export async function allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  try {
    const [row] = await db
      .insert(s.rateLimits)
      .values({ key: `${key}:${windowSeconds}`, windowStart, count: 1 })
      .onConflictDoUpdate({ target: [s.rateLimits.key, s.rateLimits.windowStart], set: { count: sql`${s.rateLimits.count} + 1` } })
      .returning({ count: s.rateLimits.count });
    return (row?.count ?? 1) <= limit;
  } catch (e) {
    console.error("[rate-limit]", (e as Error).message);
    return true;
  }
}

/** Every limit in `checks` must have room. Each is counted, so a refused call still uses its turn. */
export async function allowAll(checks: [key: string, limit: number, windowSeconds: number][]) {
  const results = await Promise.all(checks.map(([key, limit, seconds]) => allow(key, limit, seconds)));
  return results.every(Boolean);
}

/** Windows that ended more than two days ago. Called by the scheduled job. */
export async function sweepRateLimits() {
  await db.delete(s.rateLimits).where(lt(s.rateLimits.windowStart, new Date(Date.now() - 2 * 86_400_000)));
}

/** The caller's address, for limits on things with no account behind them. */
export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
