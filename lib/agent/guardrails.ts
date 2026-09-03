import type { AgentConfig, Trigger } from "./config";
import { MIN_RETRIEVAL_CONFIDENCE } from "./model";

/**
 * Escalation triggers.
 *
 * Evaluated on every customer turn, before the model is asked for a reply. A
 * fired trigger short-circuits generation entirely: the agent holds the
 * customer with a status update and a brief goes to the handoff queue. It
 * never negotiates its way past one.
 */

export type ConversationState = {
  /** Everything the customer has said this conversation, oldest first. */
  customerUtterances: string[];
  /** Latest sentiment reading, −1 to 1. */
  sentiment: number | null;
  /** How many times the customer has asked for a person. */
  humanRequests: number;
  /** The customer's current blended priority, if they are known. */
  priority: number | null;
  /** Best retrieval confidence for the current question. */
  retrievalConfidence: number | null;
  /** Set when an action was refused for exceeding a ceiling. */
  authorityExceeded: boolean;
};

export type FiredTrigger = { trigger: Trigger; detail: string };

const HUMAN_PHRASES = [
  "speak to a human",
  "speak to someone",
  "talk to a person",
  "real person",
  "put me through",
  "someone who can decide",
  "a manager",
];

/** How many times the customer has asked for a person, from their own words. */
export function countHumanRequests(utterances: string[]): number {
  return utterances.filter((u) => {
    const text = u.toLowerCase();
    return HUMAN_PHRASES.some((p) => text.includes(p));
  }).length;
}

function evaluate(trigger: Trigger, state: ConversationState): string | null {
  const rule = trigger.rule as {
    kind?: string;
    any?: string[];
    below?: number;
    above?: number;
    atLeast?: number;
  };

  switch (rule.kind) {
    case "phrase": {
      const latest = state.customerUtterances.at(-1)?.toLowerCase() ?? "";
      const hit = (rule.any ?? []).find((p) => latest.includes(p.toLowerCase()));
      return hit ? `Customer said "${hit}".` : null;
    }

    case "human_requests":
      return state.humanRequests >= (rule.atLeast ?? 2)
        ? `Asked for a person ${state.humanRequests} times.`
        : null;

    case "sentiment":
      return state.sentiment !== null && state.sentiment < (rule.below ?? -0.4)
        ? `Sentiment ${state.sentiment.toFixed(2)} is below ${rule.below}.`
        : null;

    case "authority_exceeded":
      return state.authorityExceeded ? "Request exceeds an authority ceiling." : null;

    case "retrieval_confidence":
      return state.retrievalConfidence !== null &&
        state.retrievalConfidence < (rule.below ?? MIN_RETRIEVAL_CONFIDENCE)
        ? `Best document match ${(state.retrievalConfidence * 100).toFixed(0)}% is below the bar.`
        : null;

    case "priority":
      return state.priority !== null && state.priority > (rule.above ?? 85)
        ? `Priority ${state.priority} is above ${rule.above}.`
        : null;

    default:
      return null;
  }
}

/** Every trigger that fires for this state, in configuration order. */
export function checkTriggers(config: AgentConfig, state: ConversationState): FiredTrigger[] {
  const fired: FiredTrigger[] = [];
  for (const trigger of config.triggers) {
    const detail = evaluate(trigger, state);
    if (detail) fired.push({ trigger, detail });
  }
  return fired;
}

/** How the never-do list reads in the system prompt. */
export function describeNeverRules(config: AgentConfig): string {
  return config.neverRules.map((r) => `- ${r}`).join("\n");
}
