import { can, type Actor } from "./permissions";

/**
 * How much of a brand a person sees.
 *
 * The role matrix says whether you may read customers at all. This says
 * *which* — and it is the difference between the two jobs this console does.
 *
 * A Manager is accountable for the brand, so they see every customer and who
 * holds each one. An Agent is accountable for their own accounts, so they see
 * the customers they hold and the ones they are actually talking to, and the
 * rest is not theirs to browse. That is not a security boundary dressed up as
 * a preference — a console that shows an Agent four hundred accounts they have
 * no relationship with is a console where they cannot find their own.
 *
 * It reads off the same matrix the server enforces: `customers.read` is
 * granted `assigned` to an Agent and `full` to everyone above them, so this
 * derives from the grant rather than testing the role name. Add a role with an
 * `assigned` grant and it is scoped without touching this file.
 */

export type CustomerScope =
  | { kind: "all" }
  /** Only accounts this person owns or has spoken to. */
  | { kind: "own"; membershipId: string };

export function customerScope(
  actor: Actor,
  membershipId: string,
  brandId?: string,
): CustomerScope {
  const grant = can(actor, "customers.read", { brandId }).grant;
  return grant === "assigned" ? { kind: "own", membershipId } : { kind: "all" };
}

