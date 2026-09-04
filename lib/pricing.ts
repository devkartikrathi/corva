/**
 * What a conversation costs to serve.
 *
 * One rate card, because there were three. `analytics.ts` priced a contact at
 * a flat 68p for AI and 490p for a human; `rollup.ts` priced the same traffic
 * per minute at 11p and 42p. Both were guesses, they disagreed, and the
 * Analytics screen and the operator's unit economics were quoting different
 * numbers for the same conversations.
 *
 * These are still rates rather than invoices — the authority is your provider's
 * billing console, and every one is overridable by environment variable so a
 * deployment can hold its actual contracted price. What has changed is that
 * the *usage* is now measured rather than assumed: real tokens, real audio
 * seconds, real human handling time.
 *
 * Everything is in pence, as integers where it can be, because money in
 * floating point eventually embarrasses you.
 */

const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const RATES = {
  /** Pence per million input tokens on the turn model. */
  llmInputPerMillion: num("COST_LLM_INPUT_PER_M_PENCE", 24),
  /** Pence per million output tokens. Output is the expensive half. */
  llmOutputPerMillion: num("COST_LLM_OUTPUT_PER_M_PENCE", 200),
  /** Pence per million tokens embedded — retrieval queries and documents. */
  embeddingPerMillion: num("COST_EMBEDDING_PER_M_PENCE", 1.2),
  /** Pence per second of audio the caller speaks. */
  audioInPerSecond: num("COST_AUDIO_IN_PER_SEC_PENCE", 0.08),
  /** Pence per second of audio the agent speaks. Synthesis costs more. */
  audioOutPerSecond: num("COST_AUDIO_OUT_PER_SEC_PENCE", 0.13),
  /**
   * Pence per second of a person's time, fully loaded.
   *
   * The number that dominates every other line here, and the reason
   * containment is worth measuring at all: £18/hour is 0.5p a second, so one
   * minute of a colleague costs more than a hundred AI turns.
   */
  humanPerSecond: num("COST_HUMAN_PER_SEC_PENCE", 0.5),
} as const;

/** What was actually consumed. Every field optional; absent means unmeasured. */
export type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  embeddingTokens?: number;
  audioInSeconds?: number;
  audioOutSeconds?: number;
  humanSeconds?: number;
};

export type CostLine = {
  label: string;
  /** Tokens, or seconds — whatever the rate is per. */
  units: number;
  unit: "tokens" | "seconds";
  pence: number;
};

export type Cost = {
  /** Total in pence, rounded to the nearest hundredth so sub-penny work survives. */
  pence: number;
  lines: CostLine[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price one conversation's usage.
 *
 * Returns the components alongside the total, the same way `computeScore`
 * returns its contributions — a cost you cannot open up is a number people
 * stop believing the first time it surprises them.
 */
export function priceUsage(usage: Usage): Cost {
  const lines: CostLine[] = [];

  const add = (label: string, units: number | undefined, unit: CostLine["unit"], rate: number) => {
    if (!units) return;
    lines.push({ label, units: round2(units), unit, pence: round2(units * rate) });
  };

  add("Model input", usage.inputTokens, "tokens", RATES.llmInputPerMillion / 1_000_000);
  add("Model output", usage.outputTokens, "tokens", RATES.llmOutputPerMillion / 1_000_000);
  add("Embeddings", usage.embeddingTokens, "tokens", RATES.embeddingPerMillion / 1_000_000);
  add("Audio in", usage.audioInSeconds, "seconds", RATES.audioInPerSecond);
  add("Audio out", usage.audioOutSeconds, "seconds", RATES.audioOutPerSecond);
  add("Human handling", usage.humanSeconds, "seconds", RATES.humanPerSecond);

  return { pence: round2(lines.reduce((a, l) => a + l.pence, 0)), lines };
}

/** Add usage to a running total, for a conversation billed a turn at a time. */
export function addUsage(a: Usage, b: Usage): Usage {
  const keys: (keyof Usage)[] = [
    "inputTokens",
    "outputTokens",
    "embeddingTokens",
    "audioInSeconds",
    "audioOutSeconds",
    "humanSeconds",
  ];
  const out: Usage = {};
  for (const k of keys) {
    const sum = (a[k] ?? 0) + (b[k] ?? 0);
    if (sum > 0) out[k] = round2(sum);
  }
  return out;
}

/** "£1.24" or "38p" — money reads better without a leading zero pound. */
export function formatCost(pence: number): string {
  if (pence >= 100) return `£${(pence / 100).toFixed(2)}`;
  if (pence >= 1) return `${pence.toFixed(0)}p`;
  return `${pence.toFixed(2)}p`;
}
