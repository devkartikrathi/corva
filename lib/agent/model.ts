import { google } from "@ai-sdk/google";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { MODELS } from "./models";

/**
 * Where the models come from.
 *
 * Google Gemini, called directly with the project's own API key
 * (`GOOGLE_GENERATIVE_AI_API_KEY`) rather than through a gateway. Direct
 * instantiation also happens to be the only path where the embedding
 * `outputDimensionality` option is actually honoured — routing the same model
 * through a gateway silently returns full-width vectors.
 *
 * This is the only file that knows which provider is in use, and it no longer
 * knows *which* model: that is a per-brand decision, and the catalogue of
 * available ones is `models.ts`. Swapping provider — Sarvam for
 * Indian-language voice, say — means changing the two constructors below and
 * nothing else.
 */

/**
 * How hard the model is allowed to think.
 *
 * Gemini 3.x takes a level; there is no `"none"`, and passing one throws a Zod
 * error from the AI SDK. The 2.5 line took a token budget instead, which is
 * one of the reasons the catalogue is 3.x-only.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Whether a failure is the provider being busy rather than the request being
 * wrong. Only these are worth trying elsewhere — a malformed request fails the
 * same way on every model.
 */
function isOverloaded(e: unknown): boolean {
  const err = e as { statusCode?: number; message?: string; lastError?: unknown };
  if (err?.lastError) return isOverloaded(err.lastError);
  if (err?.statusCode && [429, 500, 502, 503, 504].includes(err.statusCode)) return true;
  return /high demand|overloaded|unavailable|resource_exhausted|rate limit|quota/i.test(err?.message ?? "");
}

/**
 * Try the brand's model, then the others, when the provider is busy.
 *
 * A model being "at high demand" for an hour is routine on Gemini's free tier,
 * and it used to mean every call to every business on that model failed until
 * it passed. Falling through to a sibling keeps the phones answered; the
 * console still records which model the brand is set to, and the log says
 * when a call went elsewhere.
 */
/**
 * How long a model gets to start answering before the next one is tried.
 *
 * An overloaded Gemini model does not always fail fast — one took 76 seconds
 * to return its "high demand" error — and a caller on web chat will not wait
 * that long for the first word. For a stream this is time to the first byte
 * of the response, not the whole answer.
 */
const FIRST_RESPONSE_MS = Number(process.env.MODEL_FIRST_RESPONSE_MS ?? 15_000);

/**
 * The same limit for a call that only returns once it is finished — a brief,
 * a classification, a website rewrite. Those think harder and nobody is
 * waiting on them in silence, so they get longer.
 */
const WHOLE_ANSWER_MS = Number(process.env.MODEL_WHOLE_ANSWER_MS ?? 90_000);

class SlowModel extends Error {
  constructor(id: string, ms: number) {
    super(`${id} did not answer within ${ms / 1000}s`);
  }
}

/**
 * Models that failed recently, and until when to leave them alone.
 *
 * Per process and deliberately short-lived: "high demand" on one model tends
 * to last minutes, and without this every single turn in that window would
 * spend its first fifteen seconds rediscovering it.
 */
const COOL_DOWN_MS = 5 * 60_000;
const coolingUntil = new Map<string, number>();
const cooling = (id: string) => (coolingUntil.get(id) ?? 0) > Date.now();

const fallbackMiddleware = (primary: string): LanguageModelMiddleware => {
  const candidates = [primary, ...MODELS.map((m) => m.id).filter((id) => id !== primary)];

  /**
   * Run one call against each model in turn until one answers. Every attempt
   * gets its own abort signal, tied to the caller's, so a model abandoned for
   * being slow stops being paid for.
   */
  const attempt = async <T,>(
    params: { abortSignal?: AbortSignal },
    limitMs: number,
    call: (id: string, signal: AbortSignal) => PromiseLike<T>,
  ): Promise<T> => {
    // The brand's model first, unless it has just failed; recently failed
    // models go to the back rather than being dropped, so something is tried.
    const order = [...candidates.filter((id) => !cooling(id)), ...candidates.filter(cooling)];
    let last: unknown;
    for (const [i, id] of order.entries()) {
      if (i > 0) console.warn(`${order[i - 1]} is unavailable — answering on ${id} instead`);
      const controller = new AbortController();
      const onAbort = () => controller.abort(params.abortSignal?.reason);
      params.abortSignal?.addEventListener("abort", onAbort);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          call(id, controller.signal),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new SlowModel(id, limitMs));
            }, limitMs);
          }),
        ]);
      } catch (e) {
        if (params.abortSignal?.aborted) throw e;
        if (!(e instanceof SlowModel) && !isOverloaded(e)) throw e;
        coolingUntil.set(id, Date.now() + COOL_DOWN_MS);
        last = e;
      } finally {
        clearTimeout(timer);
        params.abortSignal?.removeEventListener("abort", onAbort);
      }
    }
    throw last;
  };

  return {
    specificationVersion: "v4",
    wrapGenerate: ({ params }) =>
      attempt(params, WHOLE_ANSWER_MS, (id, abortSignal) => google(id).doGenerate({ ...params, abortSignal })),
    wrapStream: ({ params }) =>
      attempt(params, FIRST_RESPONSE_MS, (id, abortSignal) => google(id).doStream({ ...params, abortSignal })),
  };
};

/** The model that answers, whichever one this brand is on — or a sibling, when it is busy. */
export const languageModel = (modelId: string) =>
  wrapLanguageModel({ model: google(modelId), middleware: fallbackMiddleware(modelId) });

/**
 * Provider options for a call at a given thinking depth.
 *
 * A function rather than a constant so the depth travels with the model it was
 * chosen for, and the two cannot drift apart between call sites.
 *
 * Worth knowing before reaching for this on a phone call: on the batch API
 * `minimal` and `low` both measured 18–25s to first token, which is why voice
 * goes through the Live API instead. See docs/VOICE.md.
 */
export const thinkingOptions = (level: ThinkingLevel) =>
  ({ google: { thinkingConfig: { thinkingLevel: level } } }) as const;

/* ─── Embeddings ───────────────────────────────────────────────────────── */

/**
 * Not a per-brand choice, and not one to make casually.
 *
 * Every stored vector was written by this model at this width; changing either
 * does not change a setting, it invalidates the index. Documents would have to
 * be re-embedded before retrieval meant anything again.
 */
export const EMBEDDING_MODEL = google.textEmbedding("gemini-embedding-001");

/**
 * 1536, matching `document_chunks.embedding`.
 *
 * The model defaults to 3072 and supports 128–3072, so this must be passed
 * explicitly on every call. Two consequences worth knowing:
 *
 *  - Reduced dimensions are Matryoshka truncations, so the vector is no
 *    longer unit-length and MUST be re-normalised before it is stored or
 *    compared. Skipping that does not error — it quietly degrades every
 *    cosine distance in the index.
 *  - Documents and queries are embedded with different task types
 *    (RETRIEVAL_DOCUMENT vs RETRIEVAL_QUERY) into the same space, which is
 *    what the model is tuned for in retrieval.
 */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * Below this cosine similarity the AI must not answer from a document. It is
 * the "no document matches above 60% confidence" escalation trigger, and the
 * number the Knowledge screen reports gaps against.
 */
export const MIN_RETRIEVAL_CONFIDENCE = 0.6;
