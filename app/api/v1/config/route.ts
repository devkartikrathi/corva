import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { industryFor } from "@/lib/business/industries";
import { intakeFieldsFor } from "@/lib/business/intake";
import { formatPhone } from "@/lib/business/phone";
import { handle } from "@/lib/integrations/api";
import { voiceBridge } from "@/lib/integrations/keys";
import { accountState, blocked } from "@/lib/billing/usage";

/**
 * GET /api/v1/config — how this business is set up, for a site to build on.
 *
 * Everything a website needs in order not to hard-code the business: what the
 * assistant is called, what can be booked, which details the business collects
 * (so a form can show the same fields the assistant asks for), and which
 * features are switched on. Changes in the console show up here at once, so a
 * site that reads this never needs redeploying when the business edits a field.
 */
export const GET = handle<unknown>(async (brand) => {
  const [[phone], fields] = await Promise.all([
    db
      .select({ address: s.channels.address })
      .from(s.channels)
      .where(and(eq(s.channels.brandId, brand.id), eq(s.channels.kind, "phone")))
      .limit(1),
    intakeFieldsFor(brand.id, brand.industry),
  ]);
  const industry = industryFor(brand.industry);
  const bridge = voiceBridge();
  const account = await accountState(brand.orgId);
  return {
    business: brand.name,
    assistant: brand.agentName,
    industry: { key: industry.key, label: industry.label },
    phoneNumber: phone?.address ? formatPhone(phone.address) : null,
    // Off when the business's plan has no room for a new conversation, so a
    // site can hide the chat or the call button rather than offer a refusal.
    features: {
      chat: !blocked(account, "chat"),
      leads: true,
      voice: bridge.available && !blocked(account, "voice"),
      voiceSecure: bridge.url.startsWith("wss://"),
    },
    /** What can be booked in chat, or null when the business only takes callbacks. */
    booking: industry.booking ?? null,
    /** The business's Details to collect, in order. `key` is what `details` objects are keyed by. */
    fields: fields.map(({ key, label, hint, kind, options, required }) => ({ key, label, hint, kind, options, required })),
    apiVersion: "v1",
  };
});
