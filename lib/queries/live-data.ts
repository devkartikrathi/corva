import { eq, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";

/**
 * The one predicate that keeps rehearsals out of the numbers.
 *
 * Test calls are written to the same tables as everything else, which is what
 * makes the voice playground worth having — you watch a real conversation
 * appear on the live console and land in the archive. But they must not reach
 * containment, cost, fleet health or a customer's priority score, because
 * those are numbers people decide things on.
 *
 * It lives here, alone, so that "which queries exclude test traffic" has one
 * answer you can grep for rather than a scattering of inline booleans that
 * drift apart. The rule for using it:
 *
 *   metrics, rollups, scoring   → exclude
 *   live consoles, archive,     → include, because you are watching the call
 *   search, a customer timeline    happen and hiding it would be a lie
 */
export const realTraffic = () => eq(s.conversations.isTest, false);

/**
 * How long a conversation may go quiet and still count as live.
 *
 * A bridge that crashes or a browser that closes without a clean disconnect
 * leaves a row marked `live` behind it, and the live console shows the newest
 * live conversation — so one abandoned row hides every real call placed after
 * it. `reapStaleCalls` closes them on a schedule; this makes the screens right
 * in between, without waiting for a job to run.
 *
 * Measured from the last turn, not from the start: a long call with someone
 * still talking is not stale.
 */
export const LIVE_IDLE_MINUTES = 15;

export const stillLive = () => sql`coalesce(
  (select max(created_at) from ${s.turns} where conversation_id = ${s.conversations.id}),
  ${s.conversations.startedAt}
) > now() - (${LIVE_IDLE_MINUTES} || ' minutes')::interval`;
