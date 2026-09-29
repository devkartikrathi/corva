import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { formatPhone } from "@/lib/business/phone";
import { handle } from "@/lib/integrations/api";
import { voiceBridge } from "@/lib/integrations/keys";

/**
 * GET /api/v1/health — is this key good, and what can this business use?
 *
 * The first call a developer makes, and the one a site can make at start-up
 * to decide which features to show: no voice button when there is no voice.
 */
export const GET = handle<unknown>(async (brand) => {
  const [phone] = await db
    .select({ address: s.channels.address })
    .from(s.channels)
    .where(and(eq(s.channels.brandId, brand.id), eq(s.channels.kind, "phone")))
    .limit(1);
  const [docs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.documents)
    .where(and(eq(s.documents.brandId, brand.id), eq(s.documents.status, "published")));
  const bridge = voiceBridge();
  return {
    ok: true,
    business: brand.name,
    assistant: brand.agentName,
    phoneNumber: phone?.address ? formatPhone(phone.address) : null,
    knowledgeDocuments: docs?.n ?? 0,
    features: {
      chat: true,
      leads: true,
      voice: bridge.available,
      voiceSecure: bridge.url.startsWith("wss://"),
    },
    apiVersion: "v1",
  };
});
