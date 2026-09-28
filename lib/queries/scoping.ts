import { eq, or, sql } from "drizzle-orm";
import * as s from "@/lib/db/schema";

/**
 * "Theirs" — the one predicate, so two screens cannot disagree about it.
 *
 * An Agent's console is their own accounts: the customers they own, and the
 * ones they have actually been in a conversation with. The second half matters
 * more than it looks — somebody who has just taken a transferred call has a
 * relationship with that customer whether or not anyone has got round to
 * setting an owner, and a screen that hid them at exactly that moment would be
 * wrong in the most annoying possible way.
 *
 * "Handled" is any of three things, because a person can arrive at a
 * conversation by three routes: the handoff was accepted by them, it is
 * ringing at them right now, or they are the named human on the conversation.
 * The last one is matched by name because that is what `conversations.
 * handled_by` holds — a denormalised label, not a key.
 *
 * ── One thing to know before editing these ─────────────────────────────────
 * Outer columns are written out in full (`customers.id`), never interpolated
 * as `${s.customers.id}`. Drizzle qualifies an interpolated column in a
 * `where` and not in a `select` projection, and the difference is invisible at
 * the call site — the table of which positions do what is in `lib/db/index.ts`,
 * beside the client it is a property of, and `npm run check:sql` asserts it.
 *
 * This file is the worked example. Written the other way, `handledByThem`
 * emitted `where c.customer_id = "id"`, which bound to `conversations.id`;
 * `teamPerformance` emitted `where h.accepted_by_membership_id = "id"`, which
 * bound to `handoffs.id`. Neither errored. The Team performance screen showed
 * a full table of zeros against a database that was entirely correct, which is
 * why a browser pass did not catch it.
 *
 * These predicates are only used in a `where` today and would be safe
 * interpolated. They are written qualified anyway, because a predicate written
 * for a `where` gets lifted into a projection eventually.
 */
const handledByThem = (membershipId: string) => sql`exists (
  select 1
  from ${s.conversations} c
  left join ${s.handoffs} h on h.conversation_id = c.id
  left join ${s.memberships} m on m.id = ${membershipId}::uuid
  where c.customer_id = customers.id
    and (h.accepted_by_membership_id = ${membershipId}::uuid
         or h.routed_to_membership_id = ${membershipId}::uuid
         or c.handled_by = m.name)
)`;

/** For a query selecting from `customers`. */
export const customerIsTheirs = (membershipId: string) =>
  or(eq(s.customers.ownerMembershipId, membershipId), handledByThem(membershipId))!;

/**
 * The same rule, for a query selecting from `conversations`.
 *
 * A conversation belongs to them when its customer does — plus the case a
 * customer-scoped rule cannot reach: a conversation with no customer attached
 * at all, which they are nonetheless holding. An unrecognised number they took
 * the line on is still their call.
 */
export const conversationIsTheirs = (membershipId: string) => sql`(
  exists (
    select 1
    from ${s.customers} cu
    where cu.id = conversations.customer_id
      and (
        cu.owner_membership_id = ${membershipId}::uuid
        or exists (
          select 1
          from ${s.conversations} c2
          left join ${s.handoffs} h2 on h2.conversation_id = c2.id
          left join ${s.memberships} m2 on m2.id = ${membershipId}::uuid
          where c2.customer_id = cu.id
            and (h2.accepted_by_membership_id = ${membershipId}::uuid
                 or h2.routed_to_membership_id = ${membershipId}::uuid
                 or c2.handled_by = m2.name)
        )
      )
  )
  or exists (
    select 1
    from ${s.handoffs} h
    where h.conversation_id = conversations.id
      and (h.accepted_by_membership_id = ${membershipId}::uuid
           or h.routed_to_membership_id = ${membershipId}::uuid)
  )
  or conversations.handled_by = (
    select m.name from ${s.memberships} m where m.id = ${membershipId}::uuid
  )
)`;
