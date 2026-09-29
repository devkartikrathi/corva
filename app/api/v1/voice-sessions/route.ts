import { handle } from "@/lib/integrations/api";
import { isPlausiblePhone, formatPhone } from "@/lib/business/phone";
import { signVoiceToken } from "@/lib/integrations/keys";
import { BRIDGE_PORT } from "@/lib/voice/config";

/**
 * POST /api/v1/voice-sessions — let a visitor talk to the assistant, by voice,
 * in their browser.
 *
 * The site's server asks for this (it holds the API key) and hands the token
 * and bridge address to the browser, which opens the call. The token is good
 * for five minutes and one business; the bridge checks it on its own.
 */
export const POST = handle<{ visitorId?: string; name?: string; phone?: string }>(async (brand, body) => {
  const phone = body.phone && isPlausiblePhone(body.phone) ? formatPhone(body.phone) : null;
  const { token, expiresInSeconds } = signVoiceToken({
    brandId: brand.id,
    callerPhone: phone,
    callerName: typeof body.name === "string" ? body.name.slice(0, 120) : null,
    visitorId: typeof body.visitorId === "string" ? body.visitorId.slice(0, 80) : null,
  });
  return {
    token,
    expiresInSeconds,
    bridgeUrl: process.env.VOICE_BRIDGE_PUBLIC_URL ?? `ws://localhost:${BRIDGE_PORT}`,
    agentName: brand.agentName,
  };
});
