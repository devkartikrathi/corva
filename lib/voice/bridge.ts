import { and, eq } from "drizzle-orm";
import WebSocket from "ws";
import {
  CALL_LIMIT_SECONDS,
  HELD_IDLE_TIMEOUT_SECONDS,
  HOLD_POLL_MS,
  IDLE_TIMEOUT_SECONDS,
  INPUT_RATE_BYTES_PER_SEC,
  LIVE_MODEL,
  LIVE_URL,
  MAX_CONCURRENT_SESSIONS,
  OUTPUT_RATE_BYTES_PER_SEC,
  resolveLiveModel,
  SESSION_CAP_SECONDS,
} from "./config";
import {
  closeVoiceConversation,
  flagNarration,
  handBackNote,
  handleToolCall,
  lineState,
  narratedATool,
  openVoiceConversation,
  persistTurn,
  setupMessage,
} from "./session";
import { classifyAndStore } from "@/lib/pipelines/classify";
import { billConversation, customerContext } from "@/lib/agent/respond";
import { followUpIfLost } from "@/lib/crm/capture";
import { knownDetails } from "@/lib/business/intake";
import { verifyVoiceToken } from "@/lib/integrations/keys";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { handleAgentClient } from "./agent";
import { openRelay, type Relay } from "./relay";

/**
 * The voice bridge: one browser call, from start to hang-up.
 *
 *   browser ──PCM16 @16k──► bridge ──► Gemini Live
 *           ◄─PCM16 @24k── bridge ◄──
 *                            │
 *                            └─ retrieval, authority, CRM, handoffs, turn rows
 *
 * The browser cannot hold the Gemini key, so it talks to this, and this talks
 * to Gemini Live with Corva's rules applied in the middle. The same function
 * serves both places a call can arrive:
 *
 *   - on Vercel, `app/api/voice/route.ts` upgrades the request to a WebSocket
 *     and hands it here (Vercel Functions can hold a WebSocket open);
 *   - locally, `npm run voice` runs a small WebSocket server that does the same,
 *     because `next dev` cannot upgrade a request.
 *
 * A call starts with a signed token (see lib/integrations/keys.ts): from a
 * business's website, or from Corva's own dialer. `requireToken: false` —
 * local development only — also accepts the dialer's older unsigned start.
 */

export type VoiceClientOptions = {
  requireToken: boolean;
  /** Keep background work alive after the call ends (Vercel's waitUntil). */
  defer?: (work: Promise<unknown>) => void;
};

let open = 0;

function key() {
  const k = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!k) throw new Error("Voice is not configured (GOOGLE_GENERATIVE_AI_API_KEY is missing).");
  return k;
}

/** A website visitor started a voice call: note it on their visit history. */
async function noteVoiceVisit(brandId: string, externalId: string, customerId: string | null) {
  try {
    const [visitor] = await db
      .select({ id: schema.visitors.id, customerId: schema.visitors.customerId })
      .from(schema.visitors)
      .where(and(eq(schema.visitors.brandId, brandId), eq(schema.visitors.externalId, externalId)))
      .limit(1);
    if (!visitor) return;
    await db.insert(schema.visitorEvents).values({ visitorId: visitor.id, type: "voice_call" });
    if (customerId && !visitor.customerId) {
      await db.update(schema.visitors).set({ customerId }).where(eq(schema.visitors.id, visitor.id));
    }
  } catch (e) {
    console.error("  could not note the visit:", (e as Error).message);
  }
}

/** The hand-over line's first sentence. Fragments arrive unspaced ("line.I'm"), so a capital also ends one. */
function firstSentence(text: string): string | null {
  return text.match(/^[\s\S]*?[.!?](?=\s|$|[A-Z])/)?.[0] ?? null;
}

/** Measured off the live model: a 70-character sentence takes about 3.3 seconds. */
const SECONDS_PER_CHARACTER = 0.05;

export const VOICE_LIMITS = { IDLE_TIMEOUT_SECONDS, MAX_CONCURRENT_SESSIONS, SESSION_CAP_SECONDS, LIVE_MODEL };

export function handleVoiceClient(client: WebSocket, opts: VoiceClientOptions) {
  const defer = opts.defer ?? ((work: Promise<unknown>) => void work.catch(() => undefined));

  let live: WebSocket | null = null;
  let conversationId: string | null = null;
  let brandId = "";
  let customerId: string | null = null;
  let isTest = true;
  // Audio is billed per second in both directions, so the bytes are counted as
  // they pass rather than inferred from how long the session was open —
  // silence on an open line is not the same as speech.
  let audioInBytes = 0;
  let audioOutBytes = 0;
  let config: Awaited<ReturnType<typeof openVoiceConversation>>["config"] | null = null;
  let startedAt = new Date();
  let closed = false;
  // Which live model this particular call is on. Chosen per session rather
  // than per process, so trying a different one does not mean restarting the
  // bridge — and recorded on the conversation, so the archive says which one
  // was on the call.
  let liveModel: string = LIVE_MODEL;

  // Transcription arrives in fragments; a turn is only written when the model
  // says the turn is over, so the row is a sentence rather than a syllable.
  let heard = "";
  let said = "";

  /**
   * Who has taken the line from the console, if anyone.
   *
   * While this is set the AI is off the call. The model is still connected and
   * still hears the caller — that is what keeps their words transcribed for the
   * person reading along — but nothing it says or tries to do gets through:
   * its audio is dropped, its transcript is not written, and its tool calls are
   * refused unrun. Enforced here, not asked of the model, for the same reason
   * the ceilings are.
   */
  let heldBy: string | null = null;
  /** The person's replies while they held it, for the hand-back note. */
  let heldReplies: { body: string }[] = [];
  let lastReplyOrdinal = -1;
  let watching = false;

  /**
   * Handing over, out loud.
   *
   * When someone takes the line the AI does not just go quiet — the caller
   * would hear dead air and wonder if they had been cut off. It finishes the
   * sentence it is on (dropped, not heard), then says one line: that it is
   * passing them to a named colleague. Only that line gets through; after it,
   * the AI is muted for as long as the person holds the call.
   *
   *   pending   waiting for the model to stop what it was saying
   *   speaking  the hand-over line is playing
   *   done      the person has the line
   */
  let announce: "pending" | "speaking" | "done" = "done";
  let announceTimer: NodeJS.Timeout | null = null;
  /** Audio sent during the hand-over line — capped, in case the model runs on. */
  let handOverBytes = 0;
  /** The hand-over sentence, once its end is in the transcript. */
  let handOverLine: string | null = null;
  /** How much audio that sentence takes to say; nothing past it is sent. */
  let handOverBudget: number | null = null;
  /** True while the model is producing a turn, so the hand-over waits for it. */
  let generating = false;
  /** The person's voice, once they open the call screen. See ./relay.ts. */
  let relay: Relay | null = null;
  /** The AI may speak: nobody holds the line, or it is saying the hand-over. */
  const aiAudible = () => !heldBy || announce === "speaking";
  /** Set when the first message is a person joining, not a caller starting. */
  let agentMode = false;

  /**
   * Whether the caller is mid-utterance, as the model has been told.
   *
   * The model is not left to detect speech (see `realtimeInputConfig` in
   * session.ts): the first audio after a pause is `activityStart`, and letting
   * go of the talk button — or audio simply stopping — is `activityEnd`, which
   * is what makes the model answer.
   */
  let callerSpeaking = false;
  let speechGap: NodeJS.Timeout | null = null;
  const endCallerTurn = () => {
    if (speechGap) clearTimeout(speechGap);
    speechGap = null;
    if (!callerSpeaking) return;
    callerSpeaking = false;
    if (live?.readyState === WebSocket.OPEN) live.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }));
  };

  let capTimer: NodeJS.Timeout | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let holdTimer: NodeJS.Timeout | null = null;

  /**
   * Server messages are handled one at a time.
   *
   * `ws` delivers events in order but does not wait for an async handler
   * before firing the next, so two frames arriving together used to run their
   * handlers concurrently — and both would try to write a turn. Chaining them
   * keeps the transcript in the order the call actually happened.
   */
  let queue: Promise<void> = Promise.resolve();
  const serialise = (work: () => Promise<void>) => {
    queue = queue.then(work).catch((e) => {
      console.error("  message handling failed:", (e as Error).message);
    });
  };

  const send = (msg: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  };

  const shutdown = async (reason: string) => {
    if (closed) return;
    closed = true;
    if (capTimer) clearTimeout(capTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (holdTimer) clearInterval(holdTimer);
    if (announceTimer) clearTimeout(announceTimer);
    if (speechGap) clearTimeout(speechGap);
    closeLine({ t: "closed", reason });

    const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
    try {
      if (conversationId) {
        if (heard.trim()) await persistTurn(conversationId, "customer", heard, startedAt);
        if (said.trim()) await persistTurn(conversationId, "ai", said, startedAt);
        await persistTurn(conversationId, "system", `Call ended: ${reason}.`, startedAt);
        await billConversation(
          conversationId,
          {
            audioInSeconds: audioInBytes / INPUT_RATE_BYTES_PER_SEC,
            audioOutSeconds: audioOutBytes / OUTPUT_RATE_BYTES_PER_SEC,
          },
          liveModel,
        );
        await closeVoiceConversation(conversationId, seconds);
        const lost = await followUpIfLost(conversationId, seconds);
        if (lost) console.log(`  new caller left no details — follow-up for ${lost.assigneeName ?? "the team"}`);

        // Name the call from its transcript, the way the nightly job does for
        // every other conversation. Deliberately not awaited: it takes tens of
        // seconds on the analysis model, and the caller has already hung up.
        // The console picks it up on its next refresh.
        const id = conversationId;
        defer(
          classifyAndStore(id)
            .then((result) => {
              if (result) console.log(`  classified ${id.slice(0, 8)}: ${result.intent}`);
            })
            .catch((e) => console.error(`  classify ${id.slice(0, 8)} failed:`, (e as Error).message)),
        );
      }
    } catch (e) {
      console.error("shutdown persistence failed:", e);
    }

    send({ type: "closed", reason, seconds });
    live?.close();
    client.close();
    open = Math.max(0, open - 1);
    console.log(`  session closed after ${seconds}s — ${reason} (${open} open)`);
  };

  // Any gap in audio from the browser closes the session. A forgotten tab is
  // the expensive failure here, so it is timed out rather than trusted.
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer);
    const seconds = heldBy ? HELD_IDLE_TIMEOUT_SECONDS : IDLE_TIMEOUT_SECONDS;
    idleTimer = setTimeout(() => void shutdown("idle"), seconds * 1000);
  };

  /** The model says the one hand-over line. */
  const sayHandOver = () => {
    if (announce !== "pending" || !heldBy || live?.readyState !== WebSocket.OPEN) return;
    announce = "speaking";
    handOverBytes = 0;
    handOverLine = null;
    handOverBudget = null;
    const first = heldBy.split(" ")[0];
    live.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [
                {
                  text:
                    `[Not from the caller.] ${heldBy}, a colleague on the team, is taking over this call now. ` +
                    `Tell the caller in one short, warm sentence, in the language of the call, that you are ` +
                    `transferring them to ${first} from the team and to please stay on the line. Say nothing else.`,
                },
              ],
            },
          ],
          turnComplete: true,
        },
      }),
    );
    // If the model never finishes the line, the person still gets the call.
    announceTimer = setTimeout(finishHandOver, 10_000);
  };

  /**
   * The hand-over line has been said: mute the AI for good.
   *
   * Called at the end of its turn, or just after its first full sentence —
   * the live model sometimes says the line two or three times over in one
   * breath, and the caller should hear it once. Only that sentence is kept.
   */
  const finishHandOver = () => {
    if (announce !== "speaking") return;
    announce = "done";
    if (announceTimer) clearTimeout(announceTimer);
    announceTimer = null;
    const line = handOverLine ?? firstSentence(said) ?? said;
    said = "";
    if (line.trim() && conversationId) {
      const id = conversationId;
      serialise(() => persistTurn(id, "ai", line, startedAt));
    }
  };

  /** The person's voice in and the caller's out, through Postgres. */
  const openLine = async (name: string) => {
    if (relay || !conversationId) return;
    try {
      relay = await openRelay(conversationId, "caller", (m) => {
        if (m.t === "join") {
          relay?.send({ t: "here", startedAt: startedAt.toISOString(), limitSeconds: CALL_LIMIT_SECONDS });
        } else if (m.t === "audio" && heldBy) {
          touch();
          if (client.readyState === WebSocket.OPEN) client.send(Buffer.from(m.d, "base64"), { binary: true });
        } else if (m.t === "hangup") {
          void shutdown(`ended by ${m.name}`);
        }
      });
      console.log(`  line open for ${name}`);
    } catch (e) {
      // Typed replies still reach the caller; only the voice path is missing.
      console.error("  could not open the line:", (e as Error).message);
    }
  };

  const closeLine = (message?: Parameters<Relay["send"]>[0]) => {
    if (!relay) return;
    if (message) relay.send(message);
    const r = relay;
    relay = null;
    setTimeout(() => void r.close(), 300);
  };

  /**
   * Notice a person taking the line, or giving it back.
   *
   * Not run through `serialise`: a tool call can hold that queue for the ten
   * seconds a brief takes to write, and a takeover must not wait behind the
   * very thing the person is stepping in to stop. Only the one write it makes
   * goes through the queue, so the transcript stays in order.
   */
  const watchLine = async () => {
    if (watching || closed || !conversationId) return;
    watching = true;
    try {
      const line = await lineState(conversationId, lastReplyOrdinal);
      if (closed) return;

      // Replies first: a person can reply and hand back between two looks, and
      // the hand-back note has to include what they said.
      for (const reply of line.replies) {
        lastReplyOrdinal = reply.ordinal;
        heldReplies.push({ body: reply.body });
        send({ type: "human", name: reply.author ?? "A colleague", text: reply.body });
      }

      if (line.heldBy && line.heldBy !== heldBy) {
        const taking = !heldBy;
        heldBy = line.heldBy;
        if (taking) {
          // Whatever the AI was halfway through saying was heard, so it is
          // written down; nothing after this point is.
          const cut = said;
          said = "";
          if (cut.trim()) {
            const id = conversationId;
            serialise(() => persistTurn(id, "ai", cut, startedAt));
          }
          // A person on the line gets the time a real call needs.
          if (capTimer) clearTimeout(capTimer);
          const left = CALL_LIMIT_SECONDS - (Date.now() - startedAt.getTime()) / 1000;
          capTimer = setTimeout(() => void shutdown("call time limit reached"), Math.max(left, 30) * 1000);
          touch();
          announce = "pending";
          if (!generating) sayHandOver();
          void openLine(heldBy);
        }
        send({ type: "held", by: heldBy });
        console.log(`  ${heldBy} took the line — AI hands over`);
      } else if (!line.heldBy && heldBy) {
        const note = handBackNote(heldBy, heldReplies);
        heldBy = null;
        heldReplies = [];
        announce = "done";
        closeLine({ t: "released" });
        // Context only: `turnComplete: false` tells the model more is coming,
        // so it waits for the caller rather than answering the note.
        if (live?.readyState === WebSocket.OPEN) {
          live.send(
            JSON.stringify({
              clientContent: { turns: [{ role: "user", parts: [{ text: note }] }], turnComplete: false },
            }),
          );
        }
        send({ type: "released" });
        console.log("  line handed back — AI live again");
      }
    } catch (e) {
      // One missed look is a second of lag, not a reason to drop the call.
      console.error("  line check failed:", (e as Error).message);
    } finally {
      watching = false;
    }
  };

  client.on("message", async (raw, isBinary) => {
    if (closed || agentMode) return;

    // A person on the team joining a call they took, not a caller.
    if (!isBinary && !conversationId) {
      let first: { type?: string; token?: unknown } = {};
      try {
        first = JSON.parse(raw.toString());
      } catch {}
      if (first.type === "join") {
        agentMode = true;
        void handleAgentClient(client, String(first.token ?? ""));
        return;
      }
    }

    // Binary frames are microphone audio, forwarded as-is — to the model,
    // which keeps transcribing, and to whoever has taken the line.
    if (isBinary) {
      touch();
      if (heldBy) relay?.sendAudio(raw as Buffer);
      audioInBytes += (raw as Buffer).length;
      if (live?.readyState === WebSocket.OPEN) {
        if (!callerSpeaking) {
          callerSpeaking = true;
          live.send(JSON.stringify({ realtimeInput: { activityStart: {} } }));
        }
        // If the "I have finished" message is lost, silence ends the turn.
        if (speechGap) clearTimeout(speechGap);
        speechGap = setTimeout(endCallerTurn, 1500);
        live.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: (raw as Buffer).toString("base64"),
              },
            },
          }),
        );
      }
      return;
    }

    const msg = JSON.parse(raw.toString());

    if (msg.type === "start") {
      if (open >= MAX_CONCURRENT_SESSIONS) {
        send({ type: "error", message: `The bridge allows ${MAX_CONCURRENT_SESSIONS} sessions at once.` });
        client.close();
        return;
      }
      open++;

      try {
        /**
         * Two ways in. A website visitor arrives with a signed token (made by
         * the app for one business, good for a few minutes); Corva's own dialer
         * arrives with a number. On a publicly reachable bridge the second must
         * be switched off — VOICE_REQUIRE_TOKEN=1 — or anyone could ring any
         * business on our bill.
         */
        let opened;
        let dialed: string | null = null;
        if (typeof msg.token === "string") {
          const grant = verifyVoiceToken(msg.token);
          if (!grant) throw new Error("This call link has expired. Refresh the page and try again.");
          dialed = grant.dialed ?? null;
          opened = await openVoiceConversation({
            brandId: grant.brandId,
            callerPhone: grant.callerPhone,
            callerName: grant.callerName,
            isTest: grant.isTest ?? false,
            // A call started from a business's own website, not dialled.
            fromWebsite: !grant.dialed,
          });
          if (grant.visitorId) defer(noteVoiceVisit(grant.brandId, grant.visitorId, opened.customer?.id ?? null));
        } else {
          if (opts.requireToken) throw new Error("This call needs a token — start it from the website or Corva's dialer.");
          dialed = msg.dialed ?? null;
          opened = await openVoiceConversation({
            dialed: msg.dialed ?? null,
            brandSlug: msg.brandSlug ?? null,
            callerPhone: msg.callerPhone ?? null,
            isTest: msg.countsInMetrics !== true,
          });
        }
        conversationId = opened.conversation.id;
        brandId = opened.brand.id;
        customerId = opened.customer?.id ?? null;
        isTest = opened.conversation.isTest;
        config = opened.config;
        startedAt = new Date();

        // Fetched *before* the socket exists, not after. Awaiting anything
        // between `new WebSocket` and `.on("open")` is a race the fast path
        // loses: the socket opens during the await, the handler is attached
        // too late, setup is never sent, and the session hangs until the
        // client gives up.
        const { text: caller } = await customerContext(opened.customer?.id ?? null);
        const known = await knownDetails(opened.conversation.id, opened.config.fields);

        liveModel = resolveLiveModel(msg.liveModel);

        live = new WebSocket(LIVE_URL(key()));

        live.on("open", () => {
          live!.send(
            JSON.stringify(
              setupMessage(
                config!,
                opened.brand.name,
                liveModel,
                caller || "The number is not recognised. You do not know who this is.",
                opened.isNewCaller,
                known,
              ),
            ),
          );
        });

        live.on("message", (data) =>
          serialise(async () => {
          const m = JSON.parse(data.toString());

          if (m.setupComplete) {
            send({
              type: "ready",
              brand: opened.brand.name,
              agent: config!.agentName,
              version: config!.version,
              customer: opened.customer?.name ?? null,
              newCaller: opened.isNewCaller,
              conversationId,
              isTest,
              brandSlug: opened.brand.slug,
              brandId: opened.brand.id,
              number: dialed,
              liveModel,
              capSeconds: SESSION_CAP_SECONDS,
            });
            capTimer = setTimeout(() => void shutdown("session cap reached"), SESSION_CAP_SECONDS * 1000);
            holdTimer = setInterval(() => void watchLine(), HOLD_POLL_MS);
            touch();
            return;
          }

          if (m.toolCall) {
            for (const call of m.toolCall.functionCalls ?? []) {
              // Off the line means off the account too. Answered rather than
              // ignored, because an unanswered call leaves the model waiting.
              if (heldBy) {
                live!.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: {
                            refused: true,
                            instruction: `${heldBy} has taken the line. Do nothing and say nothing.`,
                          },
                        },
                      ],
                    },
                  }),
                );
                console.log(`  refused ${call.name} — ${heldBy} has the line`);
                continue;
              }
              const { response, outcome } = await handleToolCall(
                call.name,
                call.args ?? {},
                { conversationId: conversationId!, brandId, config: config!, isTest, customerId },
              );
              send({ type: "tool", ...outcome });
              live!.send(
                JSON.stringify({
                  toolResponse: {
                    functionResponses: [{ id: call.id, name: call.name, response }],
                  },
                }),
              );
            }
            return;
          }

          const sc = m.serverContent;
          if (!sc) return;

          if (sc.inputTranscription?.text) {
            heard += sc.inputTranscription.text;
            send({ type: "heard", text: heard });
            relay?.send({ t: "heard", text: heard });
          }
          if (sc.modelTurn) generating = true;
          if (sc.outputTranscription?.text && aiAudible()) {
            // The AI has started answering, so the caller has finished: write
            // their words now rather than at the end of the reply, so whoever
            // is watching the console reads them while the AI is still talking.
            if (!said && heard.trim()) {
              const words = heard;
              heard = "";
              await persistTurn(conversationId!, "customer", words, startedAt);
            }
            said += sc.outputTranscription.text;
            send({ type: "said", text: announce === "speaking" ? (firstSentence(said) ?? said) : said });
            // The end of the hand-over sentence is in the transcript: let
            // through as much audio as that sentence takes to say, and no more.
            if (announce === "speaking" && handOverLine === null) {
              const line = firstSentence(said);
              if (line) {
                handOverLine = line;
                handOverBudget =
                  Math.max(handOverBytes, Math.round(line.length * SECONDS_PER_CHARACTER * OUTPUT_RATE_BYTES_PER_SEC)) +
                  Math.round(0.3 * OUTPUT_RATE_BYTES_PER_SEC);
                if (handOverBytes >= handOverBudget) finishHandOver();
              }
            }
          }

          for (const part of sc.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              const audio = Buffer.from(part.inlineData.data, "base64");
              // Counted even when dropped: the model generated it, so it is
              // billed, and the meter records what was spent, not what was heard.
              audioOutBytes += audio.length;
              // Audio goes back as a binary frame; JSON-wrapping base64 audio
              // triples the bytes on a path that is already the latency budget.
              let out = audio;
              if (announce === "speaking" && heldBy) {
                // Past the end of the sentence (or past five seconds, which is
                // more than one sentence): the model is saying it again.
                const budget = handOverBudget ?? OUTPUT_RATE_BYTES_PER_SEC * 5;
                const room = Math.max(0, budget - handOverBytes) & ~1;
                if (out.length >= room) {
                  out = out.subarray(0, room);
                  handOverBytes += out.length;
                  if (out.length && client.readyState === WebSocket.OPEN) client.send(out, { binary: true });
                  finishHandOver();
                  out = Buffer.alloc(0);
                } else handOverBytes += out.length;
              }
              if (out.length && aiAudible() && client.readyState === WebSocket.OPEN) {
                client.send(out, { binary: true });
              }
            }
          }

          // The model stopping is what makes a fragment into a turn.
          if (sc.turnComplete) {
            if (announce === "speaking") finishHandOver();
            if (heard.trim()) await persistTurn(conversationId!, "customer", heard, startedAt);
            if (said.trim()) await persistTurn(conversationId!, "ai", said, startedAt);

            // The model sometimes describes a tool call rather than making
            // one. The caller hears a promise, no ceiling is consulted, and
            // nothing is recorded — so it is surfaced as a quality failure
            // rather than passing silently.
            const narrated = said.trim() ? narratedATool(said) : null;
            if (narrated && !isTest) await flagNarration(brandId, said, narrated);
            if (narrated) {
              console.log(`  ⚠ narrated "${narrated}" instead of calling it`);
              send({ type: "tool", name: "narration", summary: `said "${narrated}" aloud instead of calling it`, allowed: false });
            }
            send({ type: "turn_complete", heard: heard.trim(), said: said.trim() });
            heard = "";
            said = "";
            generating = false;
            // The hand-over line has been said; or the model has stopped the
            // answer it was giving, so the line can be said now.
            if (announce === "pending") sayHandOver();
          }

          if (sc.interrupted) {
            generating = false;
            if (announce === "pending") sayHandOver();
            send({ type: "interrupted" });
          }
          }),
        );

        live.on("error", (e) => {
          console.error("live socket error:", e.message);
          send({ type: "error", message: e.message });
          void shutdown("live socket error");
        });
        // Why the model hung up, when it did: its close code and reason are
        // the only account of it there is, and "live socket closed" alone has
        // sent us looking through logs that no longer existed.
        live.on("close", (code: number, reason: Buffer) => {
          if (closed) return;
          const why = reason?.toString().slice(0, 200);
          console.error(`  live socket closed by the model: ${code}${why ? ` ${why}` : ""}`);
          send({
            type: "error",
            message: "The voice line dropped on our side. Please call again, or carry on in the chat.",
          });
          void shutdown(`live socket closed (${code}${why ? `: ${why}` : ""})`);
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Could not start the session.";
        console.error("start failed:", message);
        send({ type: "error", message });
        open = Math.max(0, open - 1);
        client.close();
      }
      return;
    }

    // The browser's own VAD, or a released push-to-talk key, ends the turn.
    // Trailing silence alone does not endpoint — see docs/VOICE.md.
    if (msg.type === "end_turn") {
      endCallerTurn();
      return;
    }

    if (msg.type === "stop") await shutdown("the caller hung up");
  });

  client.on("close", () => {
    if (!agentMode) void shutdown("browser disconnected");
  });
  client.on("error", () => {
    if (!agentMode) void shutdown("browser socket error");
  });
}
