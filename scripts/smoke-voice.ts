/**
 * Does a call to a number reach the right business's AI?
 *
 * Opens a session on the voice bridge the way the dialer does, waits for the
 * Live model to accept the setup (which fails loudly if a tool declaration is
 * malformed), then hangs up. No audio is sent, so nothing is said.
 *
 *   VOICE_BRIDGE_PORT=8788 npx tsx --tsconfig tsconfig.json scripts/smoke-voice.ts "+91 40 7xxx xxxx"
 *   … scripts/smoke-voice.ts --token <token from POST /api/v1/voice-sessions>
 */
import WebSocket from "ws";

const port = process.env.VOICE_BRIDGE_PORT ?? "8787";
const args = process.argv.slice(2);
const token = args[0] === "--token" ? args[1] : null;
const dialed = token ? null : args[0];
if (!dialed && !token) throw new Error("Pass the number to dial, or --token <voice token>.");

const ws = new WebSocket(`ws://localhost:${port}`);
const timer = setTimeout(() => {
  console.log("FAIL: no answer within 30s");
  process.exit(1);
}, 30_000);

ws.on("open", () =>
  ws.send(
    JSON.stringify(
      token ? { type: "start", token } : { type: "start", dialed, callerPhone: "+91 99999 00001", countsInMetrics: false },
    ),
  ),
);
ws.on("message", (raw, isBinary) => {
  if (isBinary) return;
  const m = JSON.parse(raw.toString());
  console.log("<-", m.type, m.type === "ready" ? `${m.agent} at ${m.brand} · newCaller=${m.newCaller}` : m.message ?? m.reason ?? "");
  if (m.type === "ready") {
    ws.send(JSON.stringify({ type: "stop" }));
  }
  if (m.type === "error") {
    clearTimeout(timer);
    console.log("FAIL");
    process.exit(1);
  }
  if (m.type === "closed") {
    clearTimeout(timer);
    console.log("PASS");
    process.exit(0);
  }
});
