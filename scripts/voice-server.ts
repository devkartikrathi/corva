/**
 * The voice bridge.
 *
 * The browser cannot hold the Gemini key, and Next.js route handlers cannot
 * serve WebSockets — the Next docs are explicit that "the connection closes on
 * timeout, or after the response is generated". So the bridge is its own
 * process: the browser talks to it, it talks to Gemini Live, and Corva's rules
 * are applied in the middle.
 *
 *   browser ──PCM16 @16k──► bridge ──► Gemini Live
 *           ◄─PCM16 @24k── bridge ◄──
 *                            │
 *                            └─ retrieval, authority, handoffs, turn rows
 *
 * This is a testing rig, not the production path. When real calls arrive the
 * same bridge sits behind Exotel rather than a browser, which is the point of
 * keeping the Corva logic here rather than in the page.
 *
 *   npm run voice
 */
import "../lib/db/script-env";
import { WebSocketServer, WebSocket } from "ws";
import {
  BRIDGE_PORT,
  IDLE_TIMEOUT_SECONDS,
  LIVE_MODEL,
  LIVE_URL,
  MAX_CONCURRENT_SESSIONS,
  SESSION_CAP_SECONDS,
} from "../lib/voice/config";
import {
  closeVoiceConversation,
  handleToolCall,
  openVoiceConversation,
  persistTurn,
  setupMessage,
} from "../lib/voice/session";
import { classifyAndStore } from "../lib/pipelines/classify";
import { billConversation, customerContext } from "../lib/agent/respond";
import { INPUT_RATE_BYTES_PER_SEC, OUTPUT_RATE_BYTES_PER_SEC } from "../lib/voice/config";

const KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");

let open = 0;

const wss = new WebSocketServer({ port: BRIDGE_PORT });
console.log(`voice bridge on ws://localhost:${BRIDGE_PORT}`);
console.log(`  model ${LIVE_MODEL}`);
console.log(`  cap ${SESSION_CAP_SECONDS}s · idle ${IDLE_TIMEOUT_SECONDS}s · max ${MAX_CONCURRENT_SESSIONS} concurrent\n`);

wss.on("connection", (client) => {
  let live: WebSocket | null = null;
  let conversationId: string | null = null;
  let brandId = "";
  let isTest = true;
  // Audio is billed per second in both directions, so the bytes are counted as
  // they pass rather than inferred from how long the session was open —
  // silence on an open line is not the same as speech.
  let audioInBytes = 0;
  let audioOutBytes = 0;
  let config: Awaited<ReturnType<typeof openVoiceConversation>>["config"] | null = null;
  let startedAt = new Date();
  let closed = false;

  // Transcription arrives in fragments; a turn is only written when the model
  // says the turn is over, so the row is a sentence rather than a syllable.
  let heard = "";
  let said = "";

  let capTimer: NodeJS.Timeout | null = null;
  let idleTimer: NodeJS.Timeout | null = null;

  const send = (msg: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  };

  const shutdown = async (reason: string) => {
    if (closed) return;
    closed = true;
    if (capTimer) clearTimeout(capTimer);
    if (idleTimer) clearTimeout(idleTimer);

    const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
    try {
      if (conversationId) {
        if (heard.trim()) await persistTurn(conversationId, "customer", heard, startedAt);
        if (said.trim()) await persistTurn(conversationId, "ai", said, startedAt);
        await persistTurn(conversationId, "system", `Playground session ended: ${reason}.`, startedAt);
        await billConversation(conversationId, {
          audioInSeconds: audioInBytes / INPUT_RATE_BYTES_PER_SEC,
          audioOutSeconds: audioOutBytes / OUTPUT_RATE_BYTES_PER_SEC,
        });
        await closeVoiceConversation(conversationId, seconds);

        // Name the call from its transcript, the way the nightly job does for
        // every other conversation. Deliberately not awaited: it takes tens of
        // seconds on the analysis model, and the caller has already hung up.
        // The console picks it up on its next refresh.
        const id = conversationId;
        void classifyAndStore(id)
          .then((result) => {
            if (result) console.log(`  classified ${id.slice(0, 8)}: ${result.intent}`);
          })
          .catch((e) => console.error(`  classify ${id.slice(0, 8)} failed:`, (e as Error).message));
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
        const opened = await openVoiceConversation(
          msg.brandSlug ?? "aurelius-home",
          msg.customerId ?? null,
          msg.countsInMetrics !== true,
        );
        conversationId = opened.conversation.id;
        brandId = opened.brand.id;
        isTest = opened.conversation.isTest;
        config = opened.config;
        startedAt = new Date();

        // Fetched *before* the socket exists, not after. Awaiting anything
        // between `new WebSocket` and `.on("open")` is a race the fast path
        // loses: the socket opens during the await, the handler is attached
        // too late, setup is never sent, and the session hangs until the
        // client gives up.
        const { text: caller } = await customerContext(opened.customer?.id ?? null);

        live = new WebSocket(LIVE_URL(KEY));

        live.on("open", () => {
          live!.send(
            JSON.stringify(
              setupMessage(
                config!,
                opened.brand.name,
                LIVE_MODEL,
                caller || "The number is not recognised. You do not know who this is.",
              ),
            ),
          );
        });

        live.on("message", async (data) => {
          const m = JSON.parse(data.toString());

          if (m.setupComplete) {
            send({
              type: "ready",
              brand: opened.brand.name,
              agent: config!.agentName,
              version: config!.version,
              customer: opened.customer?.name ?? null,
              conversationId,
              isTest,
              brandSlug: msg.brandSlug ?? "aurelius-home",
              capSeconds: SESSION_CAP_SECONDS,
            });
            capTimer = setTimeout(() => void shutdown("session cap reached"), SESSION_CAP_SECONDS * 1000);
            touch();
            return;
          }

          if (m.toolCall) {
            for (const call of m.toolCall.functionCalls ?? []) {
              const { response, outcome } = await handleToolCall(
                call.name,
                call.args ?? {},
                { conversationId: conversationId!, brandId, config: config!, isTest },
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
          if (sc.outputTranscription?.text) {
            said += sc.outputTranscription.text;
            send({ type: "said", text: said });
          }

          for (const part of sc.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              // Audio goes back as a binary frame; JSON-wrapping base64 audio
              // triples the bytes on a path that is already the latency budget.
              if (client.readyState === WebSocket.OPEN) {
                const audio = Buffer.from(part.inlineData.data, "base64");
                audioOutBytes += audio.length;
                client.send(audio, { binary: true });
              }
            }
          }

          // The model stopping is what makes a fragment into a turn.
          if (sc.turnComplete) {
            if (heard.trim()) await persistTurn(conversationId!, "customer", heard, startedAt);
            if (said.trim()) await persistTurn(conversationId!, "ai", said, startedAt);
            send({ type: "turn_complete", heard: heard.trim(), said: said.trim() });
            heard = "";
            said = "";
          }

          if (sc.interrupted) send({ type: "interrupted" });
        });

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
});

const bye = () => {
  console.log("\nvoice bridge stopping.");
  wss.close();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
