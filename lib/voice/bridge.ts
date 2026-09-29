import { and, eq } from "drizzle-orm";
import WebSocket from "ws";
import {
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
import { verifyVoiceToken } from "@/lib/integrations/keys";
import { db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

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
    idleTimer = setTimeout(() => void shutdown("idle"), IDLE_TIMEOUT_SECONDS * 1000);
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
        }
        send({ type: "held", by: heldBy });
        console.log(`  ${heldBy} took the line — AI muted`);
      } else if (!line.heldBy && heldBy) {
        const note = handBackNote(heldBy, heldReplies);
        heldBy = null;
        heldReplies = [];
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
    if (closed) return;

    // Binary frames are microphone audio, forwarded as-is.
    if (isBinary) {
      touch();
      audioInBytes += (raw as Buffer).length;
      if (live?.readyState === WebSocket.OPEN) {
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
          }
          if (sc.outputTranscription?.text && !heldBy) {
            // The AI has started answering, so the caller has finished: write
            // their words now rather than at the end of the reply, so whoever
            // is watching the console reads them while the AI is still talking.
            if (!said && heard.trim()) {
              const words = heard;
              heard = "";
              await persistTurn(conversationId!, "customer", words, startedAt);
            }
            said += sc.outputTranscription.text;
            send({ type: "said", text: said });
          }

          for (const part of sc.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              const audio = Buffer.from(part.inlineData.data, "base64");
              // Counted even when dropped: the model generated it, so it is
              // billed, and the meter records what was spent, not what was heard.
              audioOutBytes += audio.length;
              // Audio goes back as a binary frame; JSON-wrapping base64 audio
              // triples the bytes on a path that is already the latency budget.
              if (!heldBy && client.readyState === WebSocket.OPEN) {
                client.send(audio, { binary: true });
              }
            }
          }

          // The model stopping is what makes a fragment into a turn.
          if (sc.turnComplete) {
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
          }

          if (sc.interrupted) send({ type: "interrupted" });
          }),
        );

        live.on("error", (e) => {
          console.error("live socket error:", e.message);
          send({ type: "error", message: e.message });
          void shutdown("live socket error");
        });
        live.on("close", () => void shutdown("live socket closed"));
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
    if (msg.type === "end_turn" && live?.readyState === WebSocket.OPEN) {
      live.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
      return;
    }

    if (msg.type === "stop") await shutdown("stopped by the operator");
  });

  client.on("close", () => void shutdown("browser disconnected"));
  client.on("error", () => void shutdown("browser socket error"));
}
