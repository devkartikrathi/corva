import { ScreenRefusal, ScreenTitle } from "@/components/ui";
import { FieldsEditor } from "@/components/FieldsEditor";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { detailsInstructions, intakeFieldsFor } from "@/lib/business/intake";
import { resetDetailsToCollect, saveDetailsToCollect } from "@/lib/actions/intake";

/**
 * Details to collect: what the AI finds out from every customer.
 *
 * The list is the business's own. The AI asks for each detail naturally, on
 * chat and on calls, records the answers as it hears them, and the team sees
 * them filled in beside every live conversation and on every lead.
 */
export default async function DetailsToCollectPage() {
  const { brand, denied } = await guardScreen("agent.edit");
  if (denied) {
    return (
      <ScreenRefusal
        title="Details to collect"
        reason={refusalReason(denied)}
        next="What was collected shows beside every conversation and on every lead."
      />
    );
  }

  const fields = await intakeFieldsFor(brand.id, brand.industry);
  const agent = brand.agentName ?? "The AI";

  return (
    <section style={{ padding: "20px 24px", maxWidth: 1080 }}>
      <ScreenTitle kicker={`${brand.name} · ${agent}`} title="Details to collect" />
      <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "70ch", lineHeight: 1.5 }}>
        What {agent} finds out from every customer, on chat and on calls. It asks for these naturally — never as a
        form — and records each answer as soon as it hears it. Whoever takes over a conversation sees them filled in
        beside the transcript, and they stay on the lead for whoever follows it up. Required details are asked for
        once the customer has said what they want.
      </p>

      <div style={{ marginTop: 20 }}>
        <FieldsEditor initial={fields} agentName={agent} onSave={saveDetailsToCollect} onReset={resetDetailsToCollect} />
      </div>

      <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 700 }}>What {agent} is told</summary>
        <pre
          style={{
            marginTop: 10,
            padding: "12px 14px",
            background: "var(--color-surface)",
            border: "1px solid var(--color-neutral-400)",
            fontSize: 11.5,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
          }}
        >
          {detailsInstructions(fields, {}, "record_details")}
        </pre>
      </details>
    </section>
  );
}
