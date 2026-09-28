import { quotasToday } from "@/lib/agent/quota";

/**
 * The model catalogue, flattened for a picker.
 *
 * The screens that choose a model are asking three questions at once — is it
 * good enough for this tenant, what does it cost, and is there any left today
 * — so all three travel together rather than the UI making a second call for
 * the part that changes hourly.
 */
export type ModelOption = {
  id: string;
  label: string;
  blurb: string;
  tier: "balanced" | "economy";
  /** Whether we would put it behind an authority ceiling. */
  actions: boolean;
  /** Paise per million tokens. */
  inputPerMillion: number;
  outputPerMillion: number;
  /** Whether that rate is published or reasoned from the family. */
  rateSource: "observed" | "assumed";
  /** Today, on the provider's clock. */
  used: number;
  limit: number | null;
  remaining: number | null;
  /** Whether anyone has actually seen that ceiling, or we are assuming it. */
  quotaSource: "observed" | "assumed";
};

export async function modelOptions(): Promise<ModelOption[]> {
  const quotas = await quotasToday();
  return quotas.map((q) => ({
    id: q.model.id,
    label: q.model.label,
    blurb: q.model.blurb,
    tier: q.model.tier,
    actions: q.model.suitedTo === "conversation_and_actions",
    inputPerMillion: q.model.rates.inputPerMillion,
    outputPerMillion: q.model.rates.outputPerMillion,
    rateSource: q.model.rates.source,
    used: q.used,
    limit: q.limit,
    remaining: q.remaining,
    quotaSource: q.source,
  }));
}
