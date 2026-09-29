/**
 * The voice bridge, for local development.
 *
 * On Vercel, calls reach `app/api/voice/route.ts`, which upgrades the request
 * to a WebSocket. `next dev` cannot do that, so locally this small server
 * stands in, running exactly the same call handling (lib/voice/bridge.ts).
 *
 *   npm run voice
 */
import "../lib/db/script-env";
import { WebSocketServer } from "ws";
import { BRIDGE_PORT } from "../lib/voice/config";
import { handleVoiceClient, VOICE_LIMITS } from "../lib/voice/bridge";

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set.");

const wss = new WebSocketServer({ port: BRIDGE_PORT });
console.log(`voice bridge on ws://localhost:${BRIDGE_PORT}`);
console.log(`  default model ${VOICE_LIMITS.LIVE_MODEL} — the console may pick another per call`);
console.log(
  `  cap ${VOICE_LIMITS.SESSION_CAP_SECONDS}s · idle ${VOICE_LIMITS.IDLE_TIMEOUT_SECONDS}s · max ${VOICE_LIMITS.MAX_CONCURRENT_SESSIONS} concurrent\n`,
);

// Locally the dialer may still start without a token unless told otherwise.
wss.on("connection", (client) => handleVoiceClient(client, { requireToken: process.env.VOICE_REQUIRE_TOKEN === "1" }));

const bye = () => {
  console.log("\nvoice bridge stopping.");
  wss.close();
  process.exit(0);
};
process.on("SIGINT", bye);
process.on("SIGTERM", bye);
