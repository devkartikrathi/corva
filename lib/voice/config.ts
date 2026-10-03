import { RATES } from "@/lib/pricing";

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

/**
 * How long a call may run in all once a person has taken it over.
 *
 * The AI's cap is short because an open model costs money every second; a
 * person talking to a customer is the point of the call. The real ceiling on
 * Vercel is the function's own duration — five minutes on the Hobby plan, so
 * just under that by default. On Pro, set this (and `maxDuration` in
 * app/api/voice/route.ts) up to 800 seconds.
 */
export const CALL_LIMIT_SECONDS = Number(process.env.VOICE_CALL_LIMIT_SECONDS ?? (process.env.VERCEL ? 290 : 1800));

/** With a person on the line, the caller may listen quietly for longer. */
export const HELD_IDLE_TIMEOUT_SECONDS = Number(process.env.VOICE_HELD_IDLE_TIMEOUT_SECONDS ?? 180);

/**
 * How many calls one bridge process takes at once.
 *
 * Two on a laptop, where it guards the bill during testing. On Vercel it is
 * per function instance and instances scale out, so it only stops one
 * instance being overloaded — real businesses need more than two callers.
 */
export const MAX_CONCURRENT_SESSIONS = Number(process.env.VOICE_MAX_SESSIONS ?? (process.env.VERCEL ? 20 : 2));

/**
 * How often the bridge checks whether a person has taken the line.
 *
 * The takeover is a row written by the console, in another process, so the
 * bridge has to look. This is also the longest the AI can keep talking after
 * someone presses "Take the line" — a second is a clause, not a paragraph.
 */
export const HOLD_POLL_MS = Number(process.env.VOICE_HOLD_POLL_MS ?? 1000);

/**
 * How long a caller who asked for a person waits for one to pick up.
 *
 * Long enough for someone at their desk to see the alert and take the line;
 * short enough that a caller is not left on hold for nobody. After it the AI
 * promises a callback instead (lib/crm/callback.ts).
 */
export const PICKUP_WAIT_SECONDS = Number(process.env.VOICE_PICKUP_WAIT_SECONDS ?? 60);

/** Where the browser finds the bridge. */
export const BRIDGE_PORT = Number(process.env.VOICE_BRIDGE_PORT ?? 8787);

/**
 * The speech-to-speech models a test call can be placed on.
 *
 * A different set from the text catalogue in `lib/agent/models.ts`, and not
 * interchangeable with it: these speak into a socket over `bidiGenerateContent`
 * and carry tool calling, which is the whole reason voice goes through the Live
 * API rather than the batch one. A text model cannot take a call, and none of
 * these can serve a web chat.
 *
 * Only speech-to-speech models are listed. The same key also offers
 * `gemini-3.5-transcribe-live` (transcription only) and
 * `gemini-3.5-live-translate-preview`, but neither can hold a conversation, so
 * neither is a choice on this screen.
 */
export const LIVE_MODELS = [
  {
    id: "gemini-3.1-flash-live-preview",
    label: "Gemini 3.1 Flash Live",
    blurb: "Speech to speech with tool calling. 1.43s to first audio when measured.",
  },
  {
    id: "gemini-2.5-flash-native-audio-latest",
    label: "Gemini 2.5 Native Audio",
    blurb: "The older native-audio line. Worth a try when the newer one is unavailable.",
  },
] as const;

/** What a call uses unless the tester picks otherwise. */
export const LIVE_MODEL = process.env.VOICE_LIVE_MODEL ?? LIVE_MODELS[0].id;

/** Falls back rather than failing: an unknown id must not open a socket. */
export const resolveLiveModel = (id: string | null | undefined) =>
  LIVE_MODELS.find((m) => m.id === id)?.id ?? LIVE_MODEL;



/**
 * Bytes per second on the wire, for turning a byte count into billable audio.
 * Both directions are 16-bit mono, so two bytes a sample.
 */
export const INPUT_RATE_BYTES_PER_SEC = 16000 * 2;
export const OUTPUT_RATE_BYTES_PER_SEC = 24000 * 2;

export const LIVE_URL = (key: string) =>
  "wss://generativelanguage.googleapis.com/ws/" +
  "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=" +
  encodeURIComponent(key);

/**
 * What a minute on the line costs, for the running figure on screen.
 *
 * Derived from the same per-second audio rates the conversation is actually
 * billed at rather than carrying its own number, because the playground
 * quoting one figure while the archive recorded another is how nobody ends up
 * believing either. Half the minute in each direction: on a push-to-talk line
 * only one party is ever speaking.
 */
export const COST_PER_MINUTE_PAISE = Number(
  process.env.VOICE_COST_PER_MINUTE_PAISE ??
    (RATES.audioInPerSecond + RATES.audioOutPerSecond) * 0.5 * 60,
);
