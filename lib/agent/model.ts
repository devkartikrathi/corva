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
 * This is the only file that knows which provider is in use. Swapping to
 * another one means changing these six constants and nothing else.
 */

/**
 * The model that answers a live customer turn.
 *
 * Flash rather than Pro: retrieval has already done the hard part, so the
 * model is composing a grounded reply under a person's patience, not solving
 * a problem. `gemini-3.5-flash-lite` is the cheaper, faster step down if
 * containment holds at that level — worth measuring before assuming.
 */
export const TURN_MODEL = google("gemini-3.6-flash");

/**
 * The model that writes handoff briefs and replay evaluations. Off the
 * critical path, so it is allowed to think harder.
 */
export const ANALYSIS_MODEL = google("gemini-3.6-flash");

/**
 * Thinking depth, per path. Gemini 3.6 Flash defaults to medium; a live turn
 * does not need it and a customer is waiting.
 */
export const TURN_THINKING = "low" as const;
export const ANALYSIS_THINKING = "high" as const;

/* ─── Embeddings ───────────────────────────────────────────────────────── */

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
