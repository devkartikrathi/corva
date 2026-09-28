import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { fallbackSummary } from "@/lib/agent/summary";
import { latestScores } from "./scoring";
import { formatRupees } from "@/lib/money";
import { channelLabel, waited } from "./conversations";

/**
 * A call the AI is trying to hand to you, right now.
 *
 * This is the read behind the alert that interrupts whatever screen someone is
 * on. It is deliberately narrow: only handoffs still `waiting`, only ones
 * routed at *this* person, and only the fields that fit on a card someone
 * reads in three seconds while a customer is on the line. Everything else —
 * the full brief, the transcript, the record — is one click away and is not
 * this query's job.
 *
 * `openToAnyone` widens it to the unrouted remainder. Routing leaves a handoff
 * unassigned when nobody was available, and a queue that nobody is alerted
 * about is how a customer waits eleven minutes for a team that was simply not
 * looking at the handoffs screen.
 */

export type IncomingTransfer = {
  handoffId: string;
  conversationId: string;
  customerId: string | null;
  customerName: string;
  /** The one line: what they want and where it stuck. */
  summary: string | null;
  reason: string;
  /** "escalation" — the AI hit a limit. "closure_approval" — sign-off only. */
  kind: "escalation" | "closure_approval";
  /** Why routing chose you. Null when it is open to whoever gets there first. */
  routingReason: string | null;
  routedAtYou: boolean;
  channel: string;
  /** True while the customer is still connected — this is the urgent case. */
  live: boolean;
  wait: string;
  priority: number;
  value: string;
  openingLine: string | null;
};

export async function incomingTransfers(
  brandId: string,
  membershipId: string,
  { openToAnyone = true }: { openToAnyone?: boolean } = {},
): Promise<IncomingTransfer[]> {
  const rows = await db
    .select({ handoff: s.handoffs, conversation: s.conversations, customer: s.customers })
    .from(s.handoffs)
    .innerJoin(s.conversations, eq(s.conversations.id, s.handoffs.conversationId))
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(
      and(
        eq(s.handoffs.brandId, brandId),
        eq(s.handoffs.status, "waiting"),
        openToAnyone
          ? or(
              eq(s.handoffs.routedToMembershipId, membershipId),
              isNull(s.handoffs.routedToMembershipId),
            )
          : eq(s.handoffs.routedToMembershipId, membershipId),
      ),
    )
    .orderBy(asc(s.handoffs.waitingSince));

  if (rows.length === 0) return [];

  const scores = await latestScores(
    rows.map((r) => r.customer?.id).filter(Boolean) as string[],
  );

  const mapped = rows.map((r): IncomingTransfer => {
    const brief = (r.handoff.brief ?? {}) as { openingLine?: string };
    return {
      handoffId: r.handoff.id,
      conversationId: r.conversation.id,
      customerId: r.customer?.id ?? null,
      customerName: r.customer?.name ?? "Unidentified caller",
      summary: r.handoff.headline ?? fallbackSummary(r.conversation),
      reason: r.handoff.reason,
      kind: r.handoff.kind,
      routingReason: r.handoff.routingReason,
      routedAtYou: r.handoff.routedToMembershipId === membershipId,
      channel: channelLabel(r.conversation.channel),
      live: r.conversation.status === "live" || r.conversation.status === "waiting_human",
      wait: waited(r.handoff.waitingSince),
      priority: r.customer ? Math.round(scores.get(r.customer.id)?.blended ?? 0) : 0,
      value: r.customer ? formatRupees(r.customer.ltvPaise) : "—",
      openingLine: brief.openingLine ?? null,
    };
  });

  /**
   * Ordered by who is actually waiting.
   *
   * A closure sign-off never outranks an escalation, whoever it is addressed
   * to: nobody is on the line for it and nothing is owed, so putting one in
   * front of a live customer because it happens to be routed at you would be
   * the alert working against the thing it exists for. After that: somebody
   * still connected, then being named, then what is at stake.
   */
  return mapped.sort(
    (a, b) =>
      Number(a.kind === "closure_approval") - Number(b.kind === "closure_approval") ||
      Number(b.live) - Number(a.live) ||
      Number(b.routedAtYou) - Number(a.routedAtYou) ||
      b.priority - a.priority,
  );
}
