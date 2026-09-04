import { eq } from "drizzle-orm";
import { DarkKicker, OperatorHeader } from "@/components/operator-ui";
import { VoicePlayground } from "@/components/VoicePlayground";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { callersFor } from "@/lib/voice/session";
import { BRIDGE_PORT, COST_PER_MINUTE_PENCE, LIVE_MODEL, SESSION_CAP_SECONDS } from "@/lib/voice/config";

/**
 * The voice playground.
 *
 * In the operator console rather than the tenant one, deliberately. It is a
 * testing rig for Corva's own staff: it costs money per second, it can reach
 * any brand, and the agent it exercises is whatever version is live — none of
 * which belongs in a customer's workspace.
 *
 * What it proves is that the guardrails hold in a medium where they are harder
 * to hold. In text the console decides when the agent speaks; on a call the
 * agent is already speaking, and the only leverage is that every consequential
 * act is a tool call the bridge answers. Same rules, different seam.
 */
export default async function VoiceTestingPage() {
  await requireStaff();

  // Only brands with a live agent version can take a call at all.
  const rows = await db
    .select({ brand: s.brands, version: s.agentVersions })
    .from(s.brands)
    .innerJoin(s.agentVersions, eq(s.agentVersions.brandId, s.brands.id))
    .where(eq(s.agentVersions.status, "live"))
    .orderBy(s.brands.name);

  const brands = rows.map((r) => ({
    slug: r.brand.slug,
    name: r.brand.name,
    agentName: r.brand.agentName,
  }));

  // Who you can ring in as, per brand. The agent reasons about this record —
  // tier, lifetime value, priority, open orders — so it changes the call.
  const callers = Object.fromEntries(
    await Promise.all(brands.map(async (b) => [b.slug, await callersFor(b.slug)] as const)),
  );

  return (
    <section>
      <OperatorHeader
        kicker={`${LIVE_MODEL} · speech to speech · capped at ${SESSION_CAP_SECONDS}s`}
        title="Voice testing"
        lede="Ring a tenant's helpline as one of their customers. It writes a real conversation on a real brand — it appears on the live console, the handoff queue and the archive as any inbound call would, and a colleague watching those screens sees it happen."
      />

      {brands.length === 0 ? (
        <div style={{ padding: "28px 24px", fontSize: 13, color: "var(--color-neutral-400)", maxWidth: "62ch", lineHeight: 1.6 }}>
          No brand has a live agent version, so there is nothing to call. Publish one from a
          tenant&rsquo;s Tuning screen first.
        </div>
      ) : (
        <VoicePlayground
          bridgeUrl={`ws://localhost:${BRIDGE_PORT}`}
          brands={brands}
          callers={callers}
          costPerMinutePence={COST_PER_MINUTE_PENCE}
        />
      )}

      <div
        style={{
          borderTop: "2px solid var(--color-neutral-700)",
          padding: "18px 24px",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 28,
        }}
      >
        <div>
          <DarkKicker>Running it</DarkKicker>
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
            The bridge is a separate process — Next.js route handlers cannot hold a WebSocket
            open. Start it with{" "}
            <code style={{ color: "var(--color-bg)" }}>npm run voice</code> before pressing Start.
          </p>
        </div>
        <div>
          <DarkKicker>What it is really testing</DarkKicker>
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
            Whether the agent stays inside its authority when nobody is reading its output. Ask it
            to waive a fee: it should tell you plainly that it cannot, and offer a manager.
          </p>
        </div>
        <div>
          <DarkKicker>Why Gemini Live, for now</DarkKicker>
          <p style={{ marginTop: 10, fontSize: 12, color: "var(--color-neutral-400)", lineHeight: 1.6 }}>
            1.43s to first audio against 20.75s on the batch API, and it carries tool calling. The
            measurements, and the case for Sarvam later, are in{" "}
            <code style={{ color: "var(--color-bg)" }}>docs/VOICE.md</code>.
          </p>
        </div>
      </div>
    </section>
  );
}
