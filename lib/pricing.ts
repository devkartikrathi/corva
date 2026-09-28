/**
 * What a conversation costs to serve.
 *
 * One rate card, because there were three. `analytics.ts` priced a contact at
 * a flat rate for AI and another for a human; `rollup.ts` priced the same
 * traffic per minute at different numbers again. Both were guesses, they
 * disagreed, and the Analytics screen and the operator's unit economics were
 * quoting different figures for the same conversations.
 *
 * These are still rates rather than invoices — the authority is your provider's
 * billing console, and every one is overridable by environment variable so a
 * deployment can hold its actual contracted price. What has changed is that
 * the *usage* is now measured rather than assumed: real tokens, real audio
 * seconds, real human handling time.
 *
 * The model half of the card is no longer here at all. A brand chooses its
 * model, models cost different amounts, and pricing every conversation at one
 * model's rates was how the last set of numbers went wrong — so the per-token
 * rates travel with the model in `lib/agent/models.ts`, and this file prices
 * what is the same whoever answered.
 *
 * Everything is in paise, as integers where it can be, because money in
 * floating point eventually embarrasses you.
 */

import { resolveModel } from "@/lib/agent/models";

const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Rupees to the dollar, for provider prices published in USD. */
const USD_PAISE = num("COST_USD_PAISE", 8800);

export const RATES = {
  /**
   * Paise per million tokens embedded — retrieval queries and documents.
   * Roughly $0.015 per million on `gemini-embedding-001`.
   */
  embeddingPerMillion: num("COST_EMBEDDING_PER_M_PAISE", Math.round(0.015 * USD_PAISE)),
  /** Paise per second of audio the caller speaks. About $1 an hour. */
  audioInPerSecond: num("COST_AUDIO_IN_PER_SEC_PAISE", (1 * USD_PAISE) / 3600),
  /** Paise per second of audio the agent speaks. Synthesis costs more. */
  audioOutPerSecond: num("COST_AUDIO_OUT_PER_SEC_PAISE", (1.6 * USD_PAISE) / 3600),
  /**
   * Paise per second of a person's time, fully loaded.
   *
   * The number that dominates every other line here, and the reason
   * containment is worth measuring at all: ₹300 an hour is about 8 paise a
   * second, so a minute of a colleague's attention costs more than a hundred
   * AI turns.
   *
   * The one figure on this card that is not a provider's price. It is a
   * statement about what a support hour costs *this business*, so it is the
   * first one a deployment should overwrite with its own.
   */
  humanPerSecond: num("COST_HUMAN_PER_SEC_PAISE", 30000 / 3600),
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
  paise: number;
};

export type Cost = {
  /** Total in paise, rounded to the nearest hundredth so sub-rupee work survives. */
  paise: number;
  lines: CostLine[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Price one conversation's usage, at the rates of the model that served it.
 *
 * `modelId` is the one recorded on the conversation, not the one the brand is
 * on today — a call answered last week by the expensive model did not get
 * cheaper because someone has since moved the brand down. An unknown or
 * missing id falls back to the default model's rates, which is the same thing
 * the agent itself does with a stale id.
 *
 * Returns the components alongside the total, the same way `computeScore`
 * returns its contributions — a cost you cannot open up is a number people
 * stop believing the first time it surprises them.
 */
export function priceUsage(usage: Usage, modelId?: string | null): Cost {
  const model = resolveModel(modelId);
  const lines: CostLine[] = [];

  const add = (label: string, units: number | undefined, unit: CostLine["unit"], rate: number) => {
    if (!units) return;
    lines.push({ label, units: round2(units), unit, paise: round2(units * rate) });
  };

  add("Model input", usage.inputTokens, "tokens", model.rates.inputPerMillion / 1_000_000);
  add("Model output", usage.outputTokens, "tokens", model.rates.outputPerMillion / 1_000_000);
  add("Embeddings", usage.embeddingTokens, "tokens", RATES.embeddingPerMillion / 1_000_000);
  add("Audio in", usage.audioInSeconds, "seconds", RATES.audioInPerSecond);
  add("Audio out", usage.audioOutSeconds, "seconds", RATES.audioOutPerSecond);
  add("Human handling", usage.humanSeconds, "seconds", RATES.humanPerSecond);

  return { paise: round2(lines.reduce((a, l) => a + l.paise, 0)), lines };
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
