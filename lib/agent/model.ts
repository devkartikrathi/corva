import { google } from "@ai-sdk/google";

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

/** The model that answers, whichever one this brand is on. */
export const languageModel = (modelId: string) => google(modelId);

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
