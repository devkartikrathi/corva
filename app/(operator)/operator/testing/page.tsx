import { eq } from "drizzle-orm";
import { DarkKicker, OperatorHeader } from "@/components/operator-ui";
import { VoicePlayground } from "@/components/VoicePlayground";
import { requireStaff } from "@/lib/auth/context";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { callersFor } from "@/lib/voice/session";
import { modelOptions } from "@/lib/queries/models";
import {
  BRIDGE_PORT,
  COST_PER_MINUTE_PAISE,
  LIVE_MODELS,
  SESSION_CAP_SECONDS,
} from "@/lib/voice/config";

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

  /**
   * A test call spends more than audio.
   *
   * The call itself runs on a live model, but closing it classifies the
   * transcript, an escalation writes a brief, and an open conversation has its
   * live summary rewritten — each of those a request against a text model's
   * daily allowance, on a key every tenant shares. Four rehearsals is enough to
   * exhaust the tightest of them, which is worth seeing before pressing Start
   * rather than discovering halfway through a demo.
   */
  const models = await modelOptions();

  return (
    <section>
      <OperatorHeader
        kicker={`Speech to speech · capped at ${SESSION_CAP_SECONDS}s`}
        title="Voice testing"
        lede="Ring a tenant's helpline as one of their customers. It writes a real conversation on a real brand — it appears on the live console, the handoff queue and the archive as any inbound call would, and a colleague watching those screens sees it happen."
      />

      <div
        style={{
          borderBottom: "2px solid var(--color-neutral-700)",
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          gap: 22,
          flexWrap: "wrap",
        }}
      >
        <DarkKicker>Model requests today</DarkKicker>
        {models.map((m) => {
          const spent = m.limit !== null && m.remaining === 0;
          const low = m.limit !== null && m.remaining !== null && m.remaining <= Math.max(2, m.limit * 0.15);
          return (
            <span key={m.id} style={{ fontSize: 11.5, color: "var(--color-neutral-400)" }}>
              {m.label}{" "}
              <b
                style={{
                  color: spent
                    ? "var(--color-accent)"
                    : low
                      ? "var(--color-accent-400)"
                      : "var(--color-bg)",
                }}
              >
                {m.used}
                {m.limit === null ? "" : ` / ${m.limit}`}
              </b>
            </span>
          );
        })}
      </div>

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
          liveModels={[...LIVE_MODELS]}
          costPerMinutePaise={COST_PER_MINUTE_PAISE}
        />
      )}
    </section>
  );
}
