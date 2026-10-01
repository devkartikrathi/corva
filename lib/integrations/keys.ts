import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Credentials for a business's own systems.
 *
 * Two kinds, for two different callers:
 *
 *   API keys      held by the business's server (their website backend),
 *                 long-lived, sent as `Authorization: Bearer ck_…`.
 *   voice tokens  handed to a visitor's browser for one voice call, signed,
 *                 good for a few minutes, and checked by the voice bridge on
 *                 its own — the browser never sees an API key.
 */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Make a key. The plain key is returned once and never stored. */
export async function createApiKey(brandId: string, name: string, createdByName: string) {
  const key = `ck_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(s.apiKeys)
    .values({ brandId, name: name.trim() || "Website", prefix: key.slice(0, 7), hash: sha256(key), createdByName })
    .returning();
  return { key, row };
}

/** The business a request's key belongs to, or null. */
export async function brandForRequest(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const key = header.replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("ck_")) return null;

  const [row] = await db
    .select({ key: s.apiKeys, brand: s.brands })
    .from(s.apiKeys)
    .innerJoin(s.brands, eq(s.brands.id, s.apiKeys.brandId))
    .where(and(eq(s.apiKeys.hash, sha256(key)), isNull(s.apiKeys.revokedAt)))
    .limit(1);
  if (!row) return null;

  // After the response: "last used" is for the key list, not worth a round
  // trip — but it must still happen once the function has answered.
  after(() => db.update(s.apiKeys).set({ lastUsedAt: new Date() }).where(eq(s.apiKeys.id, row.key.id)).catch(() => undefined));
  return row.brand;
}

/* ─── Voice tokens ─────────────────────────────────────────────────────── */

/**
 * The secret both the app and the voice bridge sign with.
 *
 * `VOICE_TOKEN_SECRET` in production. Without it, one is derived from the
 * database URL — which both processes already share and nobody outside has —
 * so local development needs no extra setup.
 */
function secret() {
  const explicit = process.env.VOICE_TOKEN_SECRET;
  if (explicit) return explicit;
  return sha256(`corva-voice:${process.env.DATABASE_URL ?? ""}`);
}

export type VoiceGrant = {
  brandId: string;
  callerPhone: string | null;
  callerName: string | null;
  /** The website visitor, so the call joins their history. */
  visitorId: string | null;
  /** Corva's own dialer: the number dialled, and whether it is a rehearsal. */
  dialed?: string | null;
  isTest?: boolean;
  exp: number;
};

const VOICE_TOKEN_SECONDS = 5 * 60;

export function signVoiceToken(grant: Omit<VoiceGrant, "exp">) {
  const payload = Buffer.from(
    JSON.stringify({ ...grant, exp: Math.floor(Date.now() / 1000) + VOICE_TOKEN_SECONDS }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, expiresInSeconds: VOICE_TOKEN_SECONDS };
}

export function verifyVoiceToken(token: string): VoiceGrant | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString()) as VoiceGrant;
    if (!grant.brandId || grant.exp < Date.now() / 1000) return null;
    return grant;
  } catch {
    return null;
  }
}

/**
 * A person on the team joining a call they have taken over.
 *
 * Signed over a different message from a caller's token ("agent:" + payload),
 * so neither can ever be passed off as the other. Made by the console only
 * after it has checked that this person holds this call.
 */
export type AgentGrant = { conversationId: string; name: string; exp: number };

export function signAgentToken(grant: Omit<AgentGrant, "exp">) {
  const payload = Buffer.from(
    JSON.stringify({ ...grant, exp: Math.floor(Date.now() / 1000) + VOICE_TOKEN_SECONDS }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(`agent:${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyAgentToken(token: string): AgentGrant | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`agent:${payload}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, "base64url").toString()) as AgentGrant;
    if (!grant.conversationId || !grant.name || grant.exp < Date.now() / 1000) return null;
    return grant;
  } catch {
    return null;
  }
}

/**
 * Where browsers reach the voice bridge, and whether they can.
 *
 *   VOICE_BRIDGE_PUBLIC_URL   an explicit address, if the bridge runs elsewhere
 *   on Vercel                 this deployment's own /api/voice, over wss
 *   locally                   the `npm run voice` server on ws://localhost
 */
export function voiceBridge() {
  if (process.env.VOICE_BRIDGE_PUBLIC_URL) {
    return { url: process.env.VOICE_BRIDGE_PUBLIC_URL, available: true };
  }
  if (process.env.VERCEL) {
    const host =
      hostOf(process.env.APP_URL) ??
      (process.env.VERCEL_ENV === "production" ? process.env.VERCEL_PROJECT_PRODUCTION_URL : process.env.VERCEL_URL);
    return { url: `wss://${host}/api/voice`, available: Boolean(host) };
  }
  const url = `ws://localhost:${process.env.VOICE_BRIDGE_PORT ?? 8787}`;
  return { url, available: process.env.NODE_ENV !== "production" };
}

function hostOf(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
