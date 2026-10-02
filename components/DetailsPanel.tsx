import Link from "next/link";
import { Kicker } from "@/components/ui";
import type { IntakeField } from "@/lib/business/intake";

/**
 * The business's Details to collect, filled in as far as they go.
 *
 * Next to a live transcript this is the first thing someone taking the line
 * reads: who it is, what they want, where, when — without scrolling twenty
 * turns. A required detail nobody has asked for yet is marked, so they know
 * what to ask first.
 */
export function DetailsPanel({
  fields,
  values,
  editHref,
}: {
  fields: IntakeField[];
  values: Record<string, string>;
  /** Where the list is changed, for people who may change it. */
  editHref?: string;
}) {
  const filled = fields.filter((f) => values[f.key]).length;
  return (
    <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <Kicker>Details collected</Kicker>
        <span style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>
          {filled} of {fields.length}
        </span>
        {editHref && (
          <Link href={editHref} style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-neutral-700)" }}>
            Edit list
          </Link>
        )}
      </div>
      <dl style={{ margin: "11px 0 0", display: "flex", flexDirection: "column", gap: 7, fontSize: 12.5 }}>
        {fields.map((f) => {
          const value = values[f.key];
          return (
            <div key={f.key} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 42%) 1fr", gap: 10 }}>
              <dt style={{ color: "var(--color-neutral-800)" }}>{f.label}</dt>
              <dd
                style={{
                  margin: 0,
                  fontWeight: value ? 700 : 500,
                  color: value ? "var(--color-text)" : f.required ? "var(--color-accent-700)" : "var(--color-neutral-500)",
                  wordBreak: "break-word",
                }}
              >
                {value ?? (f.required ? "Still needed" : "—")}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
