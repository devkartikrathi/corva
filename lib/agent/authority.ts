import { formatRupees } from "@/lib/money";
import type { AgentConfig, AuthorityLimit } from "./config";

/**
 * Authority ceilings.
 *
 * The design's central claim is that the AI "doesn't improvise — it
 * escalates". That only holds if the ceiling is enforced in code: a prompt
 * instruction is a preference, but this is a gate every action passes through
 * before it can be recorded as taken.
 */

export type AuthorityDecision =
  | { allowed: true; limit: AuthorityLimit }
  | { allowed: false; limit: AuthorityLimit | null; reason: string; escalateTo: string | null };

export function checkAuthority(
  config: AgentConfig,
  action: string,
  amountPaise?: number,
): AuthorityDecision {
  const limit = config.authority.find((a) => a.action === action);

  // An action the tenant never granted is not a permission gap to be guessed
  // around — it is simply not available to the agent.
  if (!limit) {
    return {
      allowed: false,
      limit: null,
      reason: `"${action}" is not an action this agent may take.`,
      escalateTo: "human",
    };
  }

  if (limit.blocked) {
    return {
      allowed: false,
      limit,
      reason: `${limit.label} is blocked for the AI.`,
      escalateTo: limit.escalateTo,
    };
  }

  if (limit.ceilingPaise !== null && (amountPaise ?? 0) > limit.ceilingPaise) {
    return {
      allowed: false,
      limit,
      reason: `${limit.label} is capped at ${formatRupees(limit.ceilingPaise, { decimals: "auto" })} without approval.`,
      escalateTo: limit.escalateTo,
    };
  }

  return { allowed: true, limit };
}

/** How the authority table reads in the system prompt. */
export function describeAuthority(config: AgentConfig): string {
  return config.authority
    .map((a) => {
      if (a.blocked) {
        return `- ${a.label}: BLOCKED. You may not do this. ${a.escalateTo ? `Only ${a.escalateTo} can.` : ""}`.trim();
      }
      if (a.ceilingPaise === null) {
        return `- ${a.label}: no limit.`;
      }
      return `- ${a.label}: up to ${formatRupees(a.ceilingPaise, { decimals: "auto" })}. Above that, ${a.escalateTo ?? "a human"} must approve.`;
    })
    .join("\n");
}
