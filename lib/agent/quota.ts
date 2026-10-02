import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { type ModelChoice, type QuotaSource } from "./models";

/**
 * How much of today's ration is gone.
 *
 * The catalogue says what the ceiling is; this says how close we are to it.
 * The two are needed together, because a limit on its own gave no warning at
 * all — the first sign of a twenty-request day was a call failing mid-demo.
 *
 * Counted platform-wide rather than per tenant: the free tier meters the API
 * key, and every brand draws from the same allowance.
 */

/**
 * The provider's midnight, not ours.
 *
 * Google's quotas reset on Pacific time. Counting by ours would report a fresh
 * allowance while the real one was still hours from renewing, which is exactly
 * the wrong direction for a number people use to decide whether to run a test.
 * Overridable, because it is the provider's policy and not a fact about us.
 */
const RESET_TIMEZONE = process.env.QUOTA_RESET_TIMEZONE ?? "America/Los_Angeles";

/** "YYYY-MM-DD" on the provider's clock. */
export function quotaDay(now: Date = new Date()): string {
  // `en-CA` is the shortest route to ISO order out of Intl.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: RESET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Count one call against today.
 *
 * Called after the model has answered, from every path that spends a request:
 * a live turn, a test-console preview, a handoff brief, a classification, the
 * doctor's health check. Missing one does not corrupt anything — it just
 * under-reports, which is the failure mode worth having.
 *
 * Never throws. A counter that can take down the call it is counting is worse
 * than no counter, so a failure here is logged and swallowed.
 */
export async function recordModelCall(
  modelId: string,
  usage?: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  const day = quotaDay();
  try {
    await db
      .insert(s.modelUsageDaily)
      .values({
        day,
        modelId,
        requests: 1,
        inputTokens: Math.round(usage?.inputTokens ?? 0),
        outputTokens: Math.round(usage?.outputTokens ?? 0),
      })
      .onConflictDoUpdate({
        target: [s.modelUsageDaily.day, s.modelUsageDaily.modelId],
        set: {
          requests: sql`${s.modelUsageDaily.requests} + 1`,
          inputTokens: sql`${s.modelUsageDaily.inputTokens} + ${Math.round(usage?.inputTokens ?? 0)}`,
          outputTokens: sql`${s.modelUsageDaily.outputTokens} + ${Math.round(usage?.outputTokens ?? 0)}`,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    console.error(`could not record a ${modelId} call:`, (e as Error).message);
  }
}

export type ModelQuota = {
  model: ModelChoice;
  used: number;
  inputTokens: number;
  outputTokens: number;
  /** Null when nobody has recorded a ceiling for this model. */
  limit: number | null;
  remaining: number | null;
  /** 0–1, or null without a ceiling to be a fraction of. */
  fraction: number | null;
  source: QuotaSource;
};

