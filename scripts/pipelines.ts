/**
 * The nightly jobs.
 *
 *   npm run pipelines            everything
 *   npm run pipelines usage      just one
 *
 * All of them are idempotent, so a failed run is fixed by running it again.
 * In production these belong on a schedule; here they are a command, because a
 * job you cannot run by hand is a job you cannot debug.
 */
import "../lib/db/script-env";
import {
  backfillCosts,
  reapStaleCalls,
  enforceRetention,
  recomputeDocumentStats,
  recomputeHealth,
  rollUpUsage,
} from "../lib/pipelines/rollup";
import { classifyAndStore } from "../lib/pipelines/classify";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";

/**
 * Label conversations that closed without one.
 *
 * Capped per run: this is the only job that costs money per row, and an
 * unbounded backfill on a fleet-sized table is a surprise nobody wants.
 */
async function classifyPending(limit = 25) {
  const pending = await db
    .select({ id: s.conversations.id })
    .from(s.conversations)
    .where(
      and(
        eq(s.conversations.status, "resolved"),
        or(isNull(s.conversations.outcome), isNull(s.conversations.intent)),
      ),
    )
    .limit(limit);

  let done = 0;
  for (const row of pending) {
    try {
      if (await classifyAndStore(row.id)) done++;
    } catch (e) {
      console.error(`  classify ${row.id.slice(0, 8)} failed:`, (e as Error).message);
    }
  }
  return { classified: done, pending: pending.length };
}

const JOBS: Record<string, () => Promise<unknown>> = {
  // First: a stale "live" row hides every real call behind it.
  stale: reapStaleCalls,
  // Before usage, which sums what this writes.
  costs: backfillCosts,
  usage: rollUpUsage,
  health: recomputeHealth,
  documents: recomputeDocumentStats,
  retention: enforceRetention,
  classify: () => classifyPending(),
};

async function main() {
  const only = process.argv[2];
  const names = only ? [only] : Object.keys(JOBS);

  if (only && !JOBS[only]) {
    console.error(`Unknown job "${only}". Try: ${Object.keys(JOBS).join(", ")}`);
    process.exit(1);
  }

  for (const name of names) {
    const t0 = Date.now();
    try {
      const result = await JOBS[name]();
      console.log(`  ${name.padEnd(10)} ${String(Date.now() - t0).padStart(6)}ms  ${JSON.stringify(result)}`);
    } catch (e) {
      console.error(`  ${name.padEnd(10)} FAILED  ${(e as Error).message}`);
      process.exitCode = 1;
    }
  }

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.usageDaily);
  console.log(`\nusage_daily now holds ${n} rows.`);
}

main().then(() => process.exit(process.exitCode ?? 0), (e) => {
  console.error(e);
  process.exit(1);
});
