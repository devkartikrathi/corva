import { experimental_upgradeWebSocket, waitUntil } from "@vercel/functions";
import { handleVoiceClient } from "@/lib/voice/bridge";

/**
 * GET /api/voice — the voice bridge, on Vercel.
 *
 * The request is upgraded to a WebSocket (Vercel Functions hold WebSockets
 * open on Fluid Compute) and the call runs in lib/voice/bridge.ts, the same
 * code `npm run voice` runs locally. Every call must carry a signed token —
 * from a business's website (/api/v1/voice-sessions) or Corva's dialer.
 *
 * A call is capped at SESSION_CAP_SECONDS (180s by default), inside this
 * function's five minutes. Classifying the call after it ends is handed to
 * `waitUntil`, so it finishes after the socket closes.
 */
export const maxDuration = 300;

export async function GET() {
  if (!process.env.VERCEL) {
    return Response.json(
      { error: "Locally the voice bridge runs separately: `npm run voice` (ws://localhost:8787)." },
      { status: 426 },
    );
  }
  return experimental_upgradeWebSocket((ws) => handleVoiceClient(ws, { requireToken: true, defer: waitUntil }));
}
