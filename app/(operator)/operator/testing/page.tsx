import { DarkKicker, OperatorHeader } from "@/components/operator-ui";
import { VoicePlayground } from "@/components/VoicePlayground";
import { requireStaff } from "@/lib/auth/context";
import { callersFor, dialableNumbers } from "@/lib/voice/session";
import { modelOptions } from "@/lib/queries/models";
import {
  BRIDGE_PORT,
  COST_PER_MINUTE_PAISE,
  LIVE_MODELS,
  SESSION_CAP_SECONDS,
} from "@/lib/voice/config";

/**
 * Test calls.
 *
 * A dialer, because a business is reached at a number: type one, or pick one,
 * and whichever business answers on it takes the call. Your own number decides
 * who you are to them — a number they have never seen makes you a new caller,
 * which is the case worth testing most, since that is where leads come from.
 *
 * It writes a real conversation on a real business: it appears on that
 * business's live console, in its leads and follow-ups, and in its archive —
 * kept out of its numbers unless you say otherwise.
 */
export default async function VoiceTestingPage({
  searchParams,
}: {
  searchParams: Promise<{ dial?: string }>;
}) {
  await requireStaff();
  const { dial } = await searchParams;

  const numbers = await dialableNumbers();
  const callers = Object.fromEntries(
    await Promise.all(
      [...new Set(numbers.map((n) => n.brandId))].map(async (id) => [id, await callersFor(id)] as const),
    ),
  );

  // Ending a call classifies it and an escalation writes a brief — each a
  // request against the text model's daily allowance.
  const models = await modelOptions();

  return (
    <section>
      <OperatorHeader
        kicker={`Speech to speech · capped at ${SESSION_CAP_SECONDS}s`}
        title="Test calls"
        lede="Dial a business's number and talk to its AI assistant as a customer would. The call shows up live in that business's console, and whatever the AI records — leads, follow-ups, handoffs — lands there too."
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
          return (
            <span key={m.id} style={{ fontSize: 11.5, color: "var(--color-neutral-400)" }}>
              {m.label}{" "}
              <b style={{ color: spent ? "var(--color-accent)" : "var(--color-bg)" }}>
                {m.used}
                {m.limit === null ? "" : ` / ${m.limit}`}
              </b>
            </span>
          );
        })}
      </div>

      {numbers.length === 0 ? (
        <div style={{ padding: "28px 24px", fontSize: 13, color: "var(--color-neutral-400)", maxWidth: "62ch", lineHeight: 1.6 }}>
          No business has a number with an AI assistant behind it yet. Add one from{" "}
          <a href="/operator/onboarding" style={{ color: "var(--color-accent-400)" }}>
            Add a business
          </a>{" "}
          — it gets a number straight away.
        </div>
      ) : (
        <VoicePlayground
          bridgeUrl={`ws://localhost:${BRIDGE_PORT}`}
          numbers={numbers}
          callers={callers}
          liveModels={[...LIVE_MODELS]}
          costPerMinutePaise={COST_PER_MINUTE_PAISE}
          initialDial={dial}
        />
      )}
    </section>
  );
}
