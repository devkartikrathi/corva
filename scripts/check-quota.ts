/**
 * Asserts that the model counter actually counts.
 *
 * `recordModelCall` upserts: the first call of a day inserts a row, every call
 * after it takes the `ON CONFLICT DO UPDATE` branch and adds to the row. Only
 * the insert is exercised by ordinary use in a fresh database, so the branch
 * that runs for the other 499 requests of the day is the one least likely to
 * be noticed if it breaks.
 *
 * It has to be checked by effect rather than by exception, for the reason the
 * counter exists at all. `recordModelCall` swallows its own errors on purpose —
 * a counter that can take down the customer call it is counting is worse than
 * no counter — so a broken branch does not throw where anyone is looking. It
 * writes a line to a server log and the quota strip quietly stops moving,
 * which is the same "no warning, wrong number on screen" failure that the
 * whole `check:sql` boundary exists for, arrived at from the other direction.
 *
 * Worth knowing why this is not a `.toSQL()` case in `check:sql` instead. That
 * check pins where drizzle qualifies an interpolated column, and this file's
 * three templates sit in `onConflictDoUpdate.set`, which qualifies today. If
 * that ever moved, the bare form is *rejected* by Postgres rather than
 * silently mis-bound — measured: `set n = n + 1` raises `column reference "n"
 * is ambiguous`, because the target row and `excluded` are both in scope. So
 * the rendering has no silent failure mode here and does not need pinning. The
 * arithmetic does: nothing about the SQL shape would notice `+ 1` becoming
 * `= 1`, or an accumulate quietly becoming an overwrite.
 *
 * Spends no API quota — the model id is synthetic and the row is removed
 * afterwards. It does need a database.
 *
 *   npm run check:quota
 */
import "../lib/db/script-env";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";
import { quotaDay, recordModelCall } from "../lib/agent/quota";

/** Not a real model, so this can never collide with a genuine day's count. */
const PROBE = "check-quota-probe";

let failures = 0;
const ok = (m: string) => console.log(`  ok    ${m}`);
const fail = (m: string) => {
  failures++;
  console.log(`  FAIL  ${m}`);
};

const read = async () => {
  const [row] = await db
    .select()
    .from(s.modelUsageDaily)
    .where(and(eq(s.modelUsageDaily.day, quotaDay()), eq(s.modelUsageDaily.modelId, PROBE)))
    .limit(1);
  return row ?? null;
};

const clear = () => db.delete(s.modelUsageDaily).where(eq(s.modelUsageDaily.modelId, PROBE));

async function main() {
  console.log("\nModel counter");
  await clear();

  try {
    await recordModelCall(PROBE, { inputTokens: 100, outputTokens: 10 });
    const first = await read();
    if (!first) {
      // The insert failing is the loud case, and it still arrives silently:
      // the error was caught and logged, not thrown.
      fail("the first call of the day wrote no row — recordModelCall swallowed an error");
    } else if (first.requests === 1 && first.inputTokens === 100 && first.outputTokens === 10) {
      ok("first call of the day inserts (1 request, 100/10 tokens)");
    } else {
      fail(`first call wrote ${first.requests} requests, ${first.inputTokens}/${first.outputTokens} tokens — expected 1 and 100/10`);
    }

    await recordModelCall(PROBE, { inputTokens: 50, outputTokens: 5 });
    await recordModelCall(PROBE, { inputTokens: 7, outputTokens: 3 });
    const after = await read();

    if (!after) {
      fail("the row vanished after two more calls");
    } else if (after.requests !== 3) {
      fail(
        after.requests === 1
          ? "requests stuck at 1 — the conflict branch is not adding, so every call after the first is uncounted"
          : `requests is ${after.requests} after three calls — expected 3`,
      );
    } else {
      ok("later calls add rather than replace (3 requests)");
    }

    if (after && (after.inputTokens !== 157 || after.outputTokens !== 18)) {
      fail(
        after.inputTokens === 7 || after.outputTokens === 3
          ? `tokens overwritten rather than accumulated (${after.inputTokens}/${after.outputTokens}) — the counter reports only the last call`
          : `tokens are ${after.inputTokens}/${after.outputTokens} after 100+50+7 and 10+5+3 — expected 157/18`,
      );
    } else if (after) {
      ok("token counts accumulate (157 in, 18 out)");
    }
  } finally {
    await clear();
  }

  console.log(
    failures === 0
      ? "\nThe counter counts.\n"
      : `\n${failures} check(s) failed — the quota strip will under-report, and nothing at runtime will say so.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
