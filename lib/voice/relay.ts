import { Client, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";

neonConfig.webSocketConstructor = WebSocket;

/**
 * The line between a caller and the person who took their call.
 *
 * The caller's socket is held by one function instance (the bridge) and the
 * person's by another — on Vercel there is no telling which machines those
 * are, so the two cannot hand audio to each other in memory. Postgres can:
 * each side LISTENs on a channel named after the conversation and NOTIFYs the
 * other. Within one region that is a few milliseconds each way, it needs
 * nothing the app does not already run, and it crosses any network the two
 * browsers are on, which a direct browser-to-browser connection does not.
 *
 * NOTIFY payloads are capped at 8000 bytes, so audio goes in pieces small
 * enough to fit once base64-encoded.
 */

export type RelayMessage =
  /** PCM16, base64: 16 kHz from the caller, 24 kHz from the person. */
  | { t: "audio"; d: string }
  /** The person has the call screen open. Sent until the bridge answers. */
  | { t: "join"; name: string }
  /** The bridge has the caller. */
  | { t: "here"; startedAt: string; limitSeconds: number }
  /** What the caller is saying, as it is transcribed. */
  | { t: "heard"; text: string }
  | { t: "hangup"; name: string }
  | { t: "left"; name: string }
  /** Handed back to the AI. */
  | { t: "released" }
  | { t: "closed"; reason: string };

type Side = "caller" | "agent";

/** Raw bytes per audio message: 5400 → 7200 base64, under the 8000 cap with room for the envelope. */
const AUDIO_PIECE = 5400;

export type Relay = Awaited<ReturnType<typeof openRelay>>;

export async function openRelay(conversationId: string, side: Side, onMessage: (m: RelayMessage) => void) {
  // A channel name is an identifier, not a parameter: built only from the
  // conversation's uuid, hex digits and nothing else.
  const channel = `call_${conversationId.replace(/[^0-9a-f]/gi, "").toLowerCase()}`;
  // LISTEN needs a real session, not the pooler's borrowed one.
  const client = new Client(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!);
  await client.connect();
  let open = true;

  client.on("notification", (n) => {
    if (n.channel !== channel || !n.payload) return;
    try {
      const { from, n: _seq, ...message } = JSON.parse(n.payload) as RelayMessage & { from: Side; n: number };
      if (from !== side) onMessage(message as RelayMessage);
    } catch {}
  });
  client.on("error", (e) => console.error(`  relay ${side} error:`, e.message));
  await client.query(`LISTEN ${channel}`);

  /**
   * Everything waiting goes out in one statement while the previous one is in
   * flight — one round trip however much is queued, so a slow link carries
   * bigger batches instead of falling behind. Messages keep their order.
   *
   * Each carries a sequence number: Postgres delivers identical notifications
   * from one transaction only once, and two pieces of silence are identical.
   */
  let seq = 0;
  let queue: string[] = [];
  let sending = false;
  const pump = async () => {
    if (sending || !open || queue.length === 0) return;
    sending = true;
    const batch = queue;
    queue = [];
    const calls = batch.map((_, i) => `pg_notify($1, $${i + 2})`).join(", ");
    try {
      await client.query(`select ${calls}`, [channel, ...batch]);
    } catch (e) {
      console.error(`  relay ${side} send failed:`, (e as Error).message);
    } finally {
      sending = false;
      void pump();
    }
  };

  const send = (message: RelayMessage) => {
    if (!open) return;
    queue.push(JSON.stringify({ from: side, n: seq++, ...message }));
    void pump();
  };

  return {
    send,
    sendAudio(pcm: Buffer) {
      for (let at = 0; at < pcm.length; at += AUDIO_PIECE) {
        send({ t: "audio", d: pcm.subarray(at, at + AUDIO_PIECE).toString("base64") });
      }
    },
    async close() {
      if (!open) return;
      open = false;
      try {
        await client.end();
      } catch {}
    },
  };
}
