import { getConsoleContext, type ConsoleContext } from "./context";
import { can, type Capability, type Decision } from "./permissions";

/**
 * A console screen's own authorization check.
 *
 * `lib/nav.ts` decides which screens a person is offered; this decides which
 * ones actually open. They read the same matrix and use the same rule — a
 * grant of `none` closes the screen, and anything above it lets you in — so
 * the sidebar cannot offer a screen that refuses, and typing the URL cannot
 * reach one the sidebar withheld.
 *
 * The rule is `grant === "none"`, not `allowed`. `read_only` and `propose` are
 * refusals to *write*, and a screen you may look at but not change is the
 * whole job for an Analyst; gating the page on `allowed` would lock them out
 * of the archive they exist to read.
 *
 * Screens still check their own writes. This is the read gate, and the actions
 * behind each control re-check independently — neither one is load-bearing on
 * its own.
 */
export async function guardScreen(
  capability: Capability,
): Promise<ConsoleContext & { denied: Decision | null }> {
  const ctx = await getConsoleContext();
  const decision = can(ctx.session.actor, capability, { brandId: ctx.brand.id });
  return { ...ctx, denied: decision.grant === "none" ? decision : null };
}

/** The sentence a refused screen shows. Never a bare "forbidden". */
export function refusalReason(decision: Decision): string {
  return decision.allowed ? "" : decision.reason;
}
