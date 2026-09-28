"use client";

import type { ModelOption } from "@/lib/queries/models";
import { formatRupees } from "@/lib/money";

/**
 * Choosing which model answers for a brand.
 *
 * Three facts sit under the choice, because all three are load-bearing and
 * only one of them is about quality:
 *
 *   what it is for  whether we would put it behind an authority ceiling, or
 *                   only in front of documents
 *   what it costs   the rate per million tokens, which is what the archive
 *                   then prices this brand's conversations at
 *   what is left    today's requests against the daily ceiling, because the
 *                   free tier meters the key and the good model is metered
 *                   hardest
 *
 * The last one is the reason this control exists at all. A model with nothing
 * left today is not a better model.
 */

const swatch = (option: ModelOption) => {
  if (option.limit === null) return "var(--color-neutral-500)";
  if (option.remaining === 0) return "var(--color-accent)";
  return option.remaining !== null && option.remaining <= Math.max(2, option.limit * 0.15)
    ? "var(--color-accent-400)"
    : "var(--color-neutral-400)";
};

/** "18 of 20 today", or what we can honestly say instead. */
function quotaLine(option: ModelOption): string {
  if (option.limit === null) return `${option.used} today · no ceiling recorded`;
  const suffix = option.quotaSource === "assumed" ? " (assumed)" : "";
  if (option.remaining === 0) return `${option.used} of ${option.limit} today · none left${suffix}`;
  return `${option.used} of ${option.limit} today · ${option.remaining} left${suffix}`;
}

export function ModelPicker({
  options,
  value,
  onChange,
  disabled = false,
  label = "Model",
}: {
  options: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const chosen = options.find((o) => o.id === value) ?? options[0];

  return (
    <div>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "var(--color-neutral-500)",
          display: "block",
          marginBottom: 6,
        }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        style={{
          border: "1px solid var(--color-neutral-600)",
          background: "transparent",
          color: "var(--color-bg)",
          padding: "8px 10px",
          fontSize: 12.5,
          fontFamily: "inherit",
          borderRadius: 0,
          width: "100%",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} style={{ color: "var(--color-text)" }}>
            {o.label}
            {o.limit !== null && o.remaining === 0 ? " — none left today" : ""}
          </option>
        ))}
      </select>

      {chosen && (
        <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 5 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: "var(--color-neutral-400)", lineHeight: 1.5 }}>
            {chosen.blurb}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span
              aria-hidden
              style={{ width: 7, height: 7, display: "block", background: swatch(chosen), flexShrink: 0 }}
            />
            <span style={{ color: "var(--color-neutral-400)" }}>{quotaLine(chosen)}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--color-neutral-500)", lineHeight: 1.5 }}>
            {formatRupees(chosen.inputPerMillion, { decimals: "auto" })} in ·{" "}
            {formatRupees(chosen.outputPerMillion, { decimals: "auto" })} out, per million tokens
            {chosen.rateSource === "assumed" && " (assumed)"}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-neutral-500)", lineHeight: 1.5 }}>
            {chosen.actions
              ? "Suited to conversations that also act on an account."
              : "Suited to answering from documents. Weaker at calling an action rather than claiming it, so keep it away from authority ceilings until a test says otherwise."}
          </div>
        </div>
      )}
    </div>
  );
}
