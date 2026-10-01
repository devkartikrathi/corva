import WebSocket from "ws";
import { verifyAgentToken } from "@/lib/integrations/keys";
import { openRelay, type Relay } from "./relay";
import { persistHumanTurn } from "./session";

/**
 * The other end of a taken-over call: the person on the team.
 *
 * Their browser opens the same voice socket a caller does, but starts with
 * `join` and a token the console signed after checking they hold this call.
 * From there it is a relay: the caller's voice comes down as 16 kHz PCM, the
 * person's goes up as 24 kHz PCM while they hold to talk, and what they say
 * (transcribed in their browser) is written into the transcript under their
 * name. The bridge holding the caller does the rest.
 *
 *   person ── join {token} ──────────► here
 *          ◄── binary 16k (caller) ── heard {text}
 *          ── binary 24k (person) ──► said {text} · hangup
 *          ◄── released · ended {reason} · no_line
 */

/** How long to keep asking for the caller before saying the line is not live. */
const FIND_CALLER_MS = 12_000;
const ASK_EVERY_MS = 1_500;

export async function handleAgentClient(client: WebSocket, token: string) {
  const send = (msg: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(msg));
  };

  const grant = verifyAgentToken(token);
  if (!grant) {
    send({ type: "error", message: "This call link has expired. Reload the page to rejoin." });
    client.close();
    return;
  }

  let relay: Relay | null = null;
  let found = false;
  let closed = false;
  let asking: NodeJS.Timeout | null = null;
  let giveUp: NodeJS.Timeout | null = null;

  const finish = () => {
    if (closed) return;
    closed = true;
    if (asking) clearInterval(asking);
    if (giveUp) clearTimeout(giveUp);
    relay?.send({ t: "left", name: grant.name });
    // Let the goodbye go out before the connection does.
    setTimeout(() => void relay?.close(), 300);
  };

  try {
    relay = await openRelay(grant.conversationId, "agent", (m) => {
      if (m.t === "audio") {
        if (client.readyState === WebSocket.OPEN) client.send(Buffer.from(m.d, "base64"), { binary: true });
      } else if (m.t === "here") {
        if (!found) send({ type: "connected", startedAt: m.startedAt, limitSeconds: m.limitSeconds });
        found = true;
        if (asking) clearInterval(asking);
        if (giveUp) clearTimeout(giveUp);
      } else if (m.t === "heard") {
        send({ type: "heard", text: m.text });
      } else if (m.t === "released") {
        send({ type: "released" });
      } else if (m.t === "closed") {
        send({ type: "ended", reason: m.reason });
        finish();
        client.close();
      }
    });
  } catch (e) {
    console.error("  agent relay failed:", (e as Error).message);
    send({ type: "error", message: "Could not connect to the call. Try again in a moment." });
    client.close();
    return;
  }

  // The bridge only starts listening once it has noticed the takeover, which
  // can be a second after the person pressed the button — so keep asking.
  const ask = () => relay?.send({ t: "join", name: grant.name });
  ask();
  asking = setInterval(ask, ASK_EVERY_MS);
  giveUp = setTimeout(() => {
    if (asking) clearInterval(asking);
    // A conversation with no live line behind it: a chat, a finished call, or
    // a simulated one. Typed replies still work.
    if (!found) send({ type: "no_line" });
  }, FIND_CALLER_MS);

  client.on("message", (raw, isBinary) => {
    if (closed || !relay) return;
    if (isBinary) {
      relay.sendAudio(raw as Buffer);
      return;
    }
    let msg: { type?: string; text?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "said" && typeof msg.text === "string" && msg.text.trim()) {
      persistHumanTurn(grant.conversationId, grant.name, msg.text.slice(0, 2000)).catch((e) =>
        console.error("  could not write what was said:", (e as Error).message),
      );
    } else if (msg.type === "hangup") {
      relay.send({ t: "hangup", name: grant.name });
    }
  });

  client.on("close", finish);
  client.on("error", finish);
}
