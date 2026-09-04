import { eq } from "drizzle-orm";
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

/** The same rule expressed for a raw SQL fragment. */
export const REAL_TRAFFIC_SQL = "is_test = false";
