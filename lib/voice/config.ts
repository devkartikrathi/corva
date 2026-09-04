/**
 * Voice testing configuration.
 *
 * Gemini Live bills per second of audio in *and* out, so an open microphone
 * costs money whether or not anyone is talking. Every limit here exists to
 * make it impossible to leave a session running by accident, and all of them
 * are enforced by the bridge rather than the browser — a tab that crashes must
 * not be able to leave a socket open and metered.
 */

/** Hard ceiling on one session. The bridge closes the socket at this point. */
export const SESSION_CAP_SECONDS = Number(process.env.VOICE_SESSION_CAP_SECONDS ?? 180);

/** Close a session that has had no audio from the browser for this long. */
export const IDLE_TIMEOUT_SECONDS = Number(process.env.VOICE_IDLE_TIMEOUT_SECONDS ?? 45);

/** How many sessions may be open at once across the whole bridge. */
export const MAX_CONCURRENT_SESSIONS = Number(process.env.VOICE_MAX_SESSIONS ?? 2);

/** Where the browser finds the bridge. */
export const BRIDGE_PORT = Number(process.env.VOICE_BRIDGE_PORT ?? 8787);

/**
 * Speech-to-speech in one socket. The alternatives on this key are
 * `gemini-3.5-transcribe-live` (STT only) and the older
 * `gemini-2.5-flash-native-audio-latest`; see docs/VOICE.md.
 */
export const LIVE_MODEL = process.env.VOICE_LIVE_MODEL ?? "gemini-3.1-flash-live-preview";



export const LIVE_URL = (key: string) =>
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
  encodeURIComponent(key);

/** Rough Gemini Live audio pricing, for the on-screen estimate only. */
export const COST_PER_MINUTE_PENCE = Number(process.env.VOICE_COST_PER_MINUTE_PENCE ?? 8);
