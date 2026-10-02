/**
 * The models a brand can be put on, and what each one costs and is allowed.
 *
 * There is more than one entry here for a reason that has nothing to do with
 * quality: the free tier meters *requests per day, per model*, and the good
 * one is metered hardest. Twenty requests a day is four test calls. So the
 * choice of model is an operational decision — made when a company is
 * onboarded, revisited from the account screen, and rehearsed in the test
 * console before it reaches anyone's customers.
 *
 * Three kinds of fact live on each entry, and they are not equally solid:
 *
 *   rates     what the provider charges. Published list price, converted to
 *             paise. A rate, not an invoice — the billing console is the
 *             authority, and every one is overridable by environment variable.
 *   freeTier  the daily request ceiling. Marked `observed` where we have hit
 *             it ourselves and `assumed` where we have not, because a quota
 *             nobody has actually seen is a guess with a number on it.
 *   suitedTo  a recommendation, not a measurement. It is where to start, and
 *             the test console is how you find out whether it holds.
 *
 * Adding a model is one entry. Nothing else in the codebase names a model id.
 */

import type { ThinkingLevel } from "./model";

const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Rupees to the dollar, for turning a published USD list price into the paise
 * the rest of the system counts in.
 *
 * One constant rather than pre-converted numbers on each entry, so correcting
 * the rate is one edit and the arithmetic stays visible next to the price it
 * came from. Override it rather than editing every model.
 */
const USD_PAISE = num("COST_USD_PAISE", 8800);

/** A provider list price, quoted per million tokens in dollars. */
const perMillion = (usd: number) => Math.round(usd * USD_PAISE);

export type ModelTier = "balanced" | "economy";

/**
 * How much weight a number here carries.
 *
 * `observed` means someone watched it happen on this key, or the provider
 * publishes it. `assumed` means we reasoned from the family and have not
 * checked. The distinction is shown in the picker, because a rate card that
 * cannot tell you which half it is sure about invites you to trust all of it.
 */
export type QuotaSource = "observed" | "assumed";

export type ModelChoice = {
  /** The provider's id. The only place any of these strings appear. */
  id: string;
  label: string;
  tier: ModelTier;
  /** One line, in the words someone choosing would use. */
  blurb: string;
  /** Paise per million tokens. Declared, not invoiced. */
  rates: { inputPerMillion: number; outputPerMillion: number; source: QuotaSource };
  freeTier: {
    /** Null means nobody has recorded it. The counter still measures use. */
    requestsPerDay: number | null;
    source: QuotaSource;
  };
  /**
   * What we are willing to point it at before measuring.
   *
   * Every model here can call a tool — that is not the difference. The
   * difference is how reliably it calls one *instead of* saying it did, which
   * is the failure `narratedATool` exists to catch, and it gets worse as the
   * model gets cheaper. A brand that only answers questions from documents is
   * not exposed to that; a brand that credits accounts is.
   */
  suitedTo: "conversation" | "conversation_and_actions";
  /** Thinking depth per path. A live turn has someone waiting; analysis does not. */
  thinking: { turn: ThinkingLevel; analysis: ThinkingLevel };
};

/**
 * Every model an operator may choose, newest first.
 *
 * All of them are Gemini 3.x Flash variants, which is what makes them
 * interchangeable: same `thinkingLevel` parameter, same tool-calling shape,
 * same structured-output support. A 2.5-era model would not drop in — it wants
 * `thinkingBudget` instead — and `gemini-2.5-flash` is gone anyway: it answers
 * a 404 saying it is "no longer available to new users".
 *
 * Membership of this list was checked rather than assumed. `ListModels`
 * advertises models that then refuse to answer — it still lists
 * `gemini-2.5-flash` — so each id below was confirmed with an actual
 * `generateContent` call. 3.7 and 3.8 answered; nothing above 3.8 exists yet.
 *
 * What that check could not establish is each model's daily allowance, since
 * the only way to see a ceiling is to hit it. Google no longer publishes the
 * per-model table, so `freeTier` carries what has actually been observed on
 * this key and is marked `assumed` everywhere else. The counter in `quota.ts`
 * measures the half we can know for certain.
 */
export const MODELS: ModelChoice[] = [
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    tier: "balanced",
    blurb: "The newest. Confirmed answering; its daily allowance is unmeasured.",
    rates: {
      inputPerMillion: num("COST_GEMINI_38_FLASH_INPUT_PER_M_PAISE", perMillion(0.3)),
      outputPerMillion: num("COST_GEMINI_38_FLASH_OUTPUT_PER_M_PAISE", perMillion(2.5)),
      source: "assumed",
    },
    // Unrecorded rather than guessed. The counter still shows what is spent,
    // which is the number that matters before a demo either way.
    freeTier: { requestsPerDay: num("QUOTA_GEMINI_38_FLASH_PER_DAY", 0) || null, source: "assumed" },
    suitedTo: "conversation_and_actions",
    thinking: { turn: "low", analysis: "high" },
  },
  {
    id: "gemini-3.7-flash",
    label: "Gemini 3.7 Flash",
    tier: "balanced",
    blurb: "One behind the newest. Confirmed answering; allowance unmeasured.",
    rates: {
      inputPerMillion: num("COST_GEMINI_37_FLASH_INPUT_PER_M_PAISE", perMillion(0.3)),
      outputPerMillion: num("COST_GEMINI_37_FLASH_OUTPUT_PER_M_PAISE", perMillion(2.5)),
      source: "assumed",
    },
    freeTier: { requestsPerDay: num("QUOTA_GEMINI_37_FLASH_PER_DAY", 0) || null, source: "assumed" },
    suitedTo: "conversation_and_actions",
    thinking: { turn: "low", analysis: "high" },
  },
  {
    id: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    tier: "balanced",
    blurb: "The strongest of the three, and the most tightly rationed.",
    rates: {
      inputPerMillion: num("COST_GEMINI_36_FLASH_INPUT_PER_M_PAISE", perMillion(0.3)),
      outputPerMillion: num("COST_GEMINI_36_FLASH_OUTPUT_PER_M_PAISE", perMillion(2.5)),
      source: "assumed",
    },
    // Twenty a day is roughly four end-to-end test calls, and we have hit it.
    freeTier: { requestsPerDay: num("QUOTA_GEMINI_36_FLASH_PER_DAY", 20), source: "observed" },
    suitedTo: "conversation_and_actions",
    thinking: { turn: "low", analysis: "high" },
  },
  {
    id: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    tier: "balanced",
    blurb: "A generation back, and twenty-five times the daily headroom.",
    rates: {
      inputPerMillion: num("COST_GEMINI_35_FLASH_INPUT_PER_M_PAISE", perMillion(0.3)),
      outputPerMillion: num("COST_GEMINI_35_FLASH_OUTPUT_PER_M_PAISE", perMillion(2.5)),
      source: "assumed",
    },
    freeTier: { requestsPerDay: num("QUOTA_GEMINI_35_FLASH_PER_DAY", 500), source: "observed" },
    suitedTo: "conversation_and_actions",
    thinking: { turn: "low", analysis: "high" },
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    tier: "economy",
    blurb: "Cheapest and fastest. Good at answering, weaker at deciding.",
    rates: {
      inputPerMillion: num("COST_GEMINI_35_FLASH_LITE_INPUT_PER_M_PAISE", perMillion(0.1)),
      outputPerMillion: num("COST_GEMINI_35_FLASH_LITE_OUTPUT_PER_M_PAISE", perMillion(0.4)),
      source: "assumed",
    },
    // Taken to be the 3.5 family's ceiling because it shares the family, not
    // because anyone has watched it run out. Set the variable once you know.
    freeTier: { requestsPerDay: num("QUOTA_GEMINI_35_FLASH_LITE_PER_DAY", 500), source: "assumed" },
    suitedTo: "conversation",
    thinking: { turn: "low", analysis: "medium" },
  },
];

/**
 * What a brand runs on unless someone chooses otherwise.
 *
 * Deliberately not the best model. A new tenant is onboarded, tested against
 * and demonstrated long before it carries traffic, and all of that happens on
 * whatever quota is left today — so the default is the one with room in it.
 * Staff move a brand up when it is worth spending the ration on.
 */
export const DEFAULT_MODEL_ID = process.env.AGENT_DEFAULT_MODEL ?? "gemini-3.5-flash";

/**
 * What answers a business's website chat, whatever the business is set to.
 *
 * Flash Lite: a chat visitor is watching the dots, and Lite has been the one
 * that answers in a second or two while the bigger models take twenty. It is
 * still the stream fallback's first choice rather than its only one — if Lite
 * is busy or slow to start, another model answers rather than nobody.
 */
export const CHAT_MODEL_ID = process.env.AGENT_CHAT_MODEL ?? "gemini-3.5-flash-lite";

/**
 * A model by id, always.
 *
 * Falls back rather than throwing: a brand row holding an id we have since
 * retired must not be the reason a customer's call fails. The console shows
 * which model actually answered, so a silent fallback is visible afterwards.
 */
export function resolveModel(id: string | null | undefined): ModelChoice {
  return (
    MODELS.find((m) => m.id === id) ??
    MODELS.find((m) => m.id === DEFAULT_MODEL_ID) ??
    MODELS[0]
  );
}

export const isKnownModel = (id: string): boolean => MODELS.some((m) => m.id === id);

