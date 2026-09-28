import { NextResponse } from "next/server";
import { getConsoleContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { incomingTransfers } from "@/lib/queries/transfers";

/**
 * What the AI is trying to hand to whoever is reading this console.
 *
 * A route handler rather than a server component because the alert has to be
 * able to interrupt any screen, including one nobody is navigating — and
 * `router.refresh()` on every page in the app to find out whether a call is
 * ringing is a lot of re-rendering for a question with a one-row answer.
 *
 * Polled rather than pushed, for the same reason `LiveRefresh` polls: Next
 * route handlers cannot hold a socket or an SSE stream open. The voice bridge
 * has its own process precisely because of that, and a second one to push
 * console alerts is not worth it while the answer is this cheap.
 *
 * Authorization is the session's, re-derived here. The URL carries nothing —
 * no membership id, no brand — so there is nothing to tamper with.
 */
export async function GET() {
  const { session, brand } = await getConsoleContext();

  // Somebody who cannot take a call is never rung at. An Analyst reading the
  // archive should not have a customer thrown at them.
  if (!can(session.actor, "calls.handle", { brandId: brand.id }).allowed) {
    return NextResponse.json({ transfers: [] });
  }

  const transfers = await incomingTransfers(brand.id, session.membershipId);
  return NextResponse.json({ transfers });
}
