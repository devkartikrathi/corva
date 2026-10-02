import Link from "next/link";
import { ScreenHeader, ScreenRefusal } from "@/components/ui";
import { ChatTester } from "@/components/ChatTester";
import { VoicePlayground } from "@/components/VoicePlayground";
import { dialToken, endTestChat, pollTestChat, sendTestChat, startTestChat } from "@/lib/actions/test-chat";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { COST_PER_MINUTE_PAISE, LIVE_MODELS, SESSION_CAP_SECONDS } from "@/lib/voice/config";
import { callersFor, dialableNumbers } from "@/lib/voice/session";

/**
 * Try it: talk to your own assistant the way a customer would.
 *
 * A chat or a call placed here is a real conversation on the business — it
 * shows on Live, and anything the assistant records lands on Leads and
 * Follow-ups — but it is marked as a test, so it stays out of the numbers and
 * is not counted against the plan. Pick a known customer to be recognised, or
 * a fresh number to be a new one.
 */
export default async function TryPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { brand, denied } = await guardScreen("calls.handle");
  if (denied) {
    return <ScreenRefusal title="Try it" reason={refusalReason(denied)} next="Conversations with real customers are in the archive." />;
  }
  const { mode: rawMode } = await searchParams;
  const mode = rawMode === "call" ? "call" : "chat";
  const agent = brand.agentName ?? "your assistant";

  const numbers = (await dialableNumbers()).filter((n) => n.brandId === brand.id);
  const callers = { [brand.id]: await callersFor(brand.id) };

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${agent}`}
        title="Try it"
        lede={`Chat to ${agent}, or ring it, as a customer would. It shows up on Live as it happens, and what it records lands on Leads and Follow-ups. Tests are free and stay out of your numbers.`}
      />

      <div style={{ display: "flex", padding: "0 24px", borderBottom: "2px solid var(--color-divider)" }}>
        {(
          [
            ["chat", "Chat", "type, as on your website"],
            ["call", "Call", `speak — up to ${Math.round(SESSION_CAP_SECONDS / 60)} minutes`],
          ] as const
        ).map(([key, label, note]) => (
          <Link
            key={key}
            href={`/app/try?mode=${key}`}
            style={{
              padding: "11px 16px",
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--color-text)",
              borderBottom: `3px solid ${mode === key ? "var(--color-accent)" : "transparent"}`,
              marginBottom: -2,
            }}
          >
            {label} <span style={{ fontWeight: 400, color: "var(--color-neutral-700)" }}>· {note}</span>
          </Link>
        ))}
        <Link href="/app/live" style={{ marginLeft: "auto", padding: "11px 0", fontSize: 12.5, fontWeight: 700, color: "var(--color-accent-700)" }}>
          Watch it on Live →
        </Link>
      </div>

      <div className="dark-surface">
        {numbers.length === 0 ? (
          <p style={{ margin: 0, padding: "28px 24px", fontSize: 13, lineHeight: 1.6, maxWidth: "62ch" }}>
            {brand.name} has no line with a published assistant behind it yet. Publish the assistant in Behaviour &amp; limits, then come back.
          </p>
        ) : mode === "chat" ? (
          <ChatTester
            businesses={numbers.slice(0, 1)}
            callers={callers}
            initialBrandId={brand.id}
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
            initialDial={numbers[0]?.number}
          />
        )}
      </div>
    </section>
  );
}
