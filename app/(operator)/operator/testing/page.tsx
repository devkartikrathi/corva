import { DarkKicker, OperatorHeader } from "@/components/operator-ui";
import Link from "next/link";
import { ChatTester } from "@/components/ChatTester";
import { VoicePlayground } from "@/components/VoicePlayground";
import { dialToken, endTestChat, pollTestChat, sendTestChat, startTestChat } from "@/lib/actions/test-chat";
import { requireStaff } from "@/lib/auth/context";
import { callersFor, dialableNumbers } from "@/lib/voice/session";
import { modelOptions } from "@/lib/queries/models";
import {
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
  searchParams: Promise<{ dial?: string; mode?: string; brand?: string }>;
}) {
  await requireStaff();
  const { dial, mode: rawMode, brand } = await searchParams;
  const mode = rawMode === "chat" ? "chat" : "call";

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
        kicker={mode === "chat" ? "Web chat · the same AI a real chat gets" : `Speech to speech · capped at ${SESSION_CAP_SECONDS}s`}
        title="Test calls"
        lede="Ring a business, or chat to it, as a customer would. The conversation shows up live in that business's console, and whatever the AI records — leads, follow-ups, handoffs — lands there too."
      />

      <div style={{ display: "flex", padding: "0 24px", borderBottom: "2px solid var(--color-neutral-700)" }}>
        {(
          [
            ["call", "Call", "Speak, over Gemini Live"],
            ["chat", "Chat", "Type, as on web chat"],
          ] as const
        ).map(([key, label, note]) => (
          <Link
            key={key}
            href={`/operator/testing?mode=${key}${dial ? `&dial=${encodeURIComponent(dial)}` : ""}`}
            className="hov-dark"
            style={{
              padding: "11px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--color-bg)",
              borderBottom: `3px solid ${mode === key ? "var(--color-accent)" : "transparent"}`,
              marginBottom: -2,
            }}
          >
            {label} <span style={{ fontWeight: 400, color: "var(--color-neutral-500)" }}>· {note}</span>
          </Link>
        ))}
      </div>

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
      ) : mode === "chat" ? (
        <ChatTester
          businesses={[...new Map(numbers.map((n) => [n.brandId, n])).values()]}
          callers={callers}
          initialBrandId={brand ?? numbers.find((n) => dial && n.number.replace(/\D/g, "").endsWith(dial.replace(/\D/g, "").slice(-10)))?.brandId}
          onStart={startTestChat}
          onSend={sendTestChat}
          onPoll={pollTestChat}
          onEnd={endTestChat}
        />
      ) : (
        <VoicePlayground
          onToken={dialToken}
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
