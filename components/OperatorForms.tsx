"use client";

import { useState, useTransition } from "react";
import type { ModelOption } from "@/lib/queries/models";
import { ModelPicker } from "@/components/ModelPicker";

/**
 * Forms on the dark ground of Corva's own console: a business's model, its
 * number, and removing it.
 */

/**
 * Changing the model one brand answers on.
 *
 * Applies from the next conversation, not this one — so the control says so
 * rather than leaving someone to wonder why a call in progress did not change
 * character halfway through.
 */
export function BrandModelControl({
  orgSlug,
  brandId,
  brandName,
  models,
  current,
  onChange,
}: {
  orgSlug: string;
  brandId: string;
  brandName: string;
  models: ModelOption[];
  current: string;
  onChange: (orgSlug: string, brandId: string, modelId: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = value !== current;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <ModelPicker
        options={models}
        value={value}
        onChange={(id) => {
          setValue(id);
          setSaved(false);
          setError(null);
        }}
        disabled={pending}
        label={`${brandName} · model`}
      />

      {dirty && (
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onChange(orgSlug, brandId, value);
                setSaved(true);
              } catch (e) {
                setValue(current);
                setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed.");
              }
            });
          }}
          style={{
            alignSelf: "flex-start",
            fontSize: 11.5,
            fontWeight: 700,
            background: "var(--color-accent)",
            color: "var(--color-bg)",
            padding: "7px 12px",
          }}
        >
          {pending ? "Moving…" : "Move to this model"}
        </button>
      )}

      {saved && !dirty && (
        <span style={{ fontSize: 11, color: "var(--color-neutral-400)" }}>
          Saved. It takes effect on the next conversation.
        </span>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--color-accent-400)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

const darkField: React.CSSProperties = {
  border: "1px solid var(--color-neutral-600)",
  background: "transparent",
  color: "var(--color-bg)",
  padding: "7px 9px",
  fontSize: 12.5,
  fontFamily: "inherit",
  borderRadius: 0,
};

const errorText = (e: unknown) =>
  e instanceof Error && !e.message.startsWith("Minified React error") ? e.message.replace(/^Error:\s*/, "") : "That did not work.";

/** The number a business answers on. */
export function NumberControl({
  current,
  onSave,
}: {
  current: string | null;
  onSave: (number: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState(current ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          inputMode="tel"
          aria-label="Phone number"
          style={{ ...darkField, width: 200, fontWeight: 700 }}
        />
        <button
          type="button"
          className="hov-accent-dark"
          disabled={pending || !value.trim() || value === current}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onSave(value);
                setSaved(true);
              } catch (e) {
                setError(errorText(e));
              }
            });
          }}
          style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "0 12px" }}
        >
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>
      {error && <span style={{ fontSize: 11.5, color: "var(--color-accent-400)" }}>{error}</span>}
    </div>
  );
}

/** Remove a business — typed confirmation, because it takes everything with it. */
export function RemoveBusiness({
  name,
  onRemove,
}: {
  name: string;
  onRemove: (confirmName: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hov-invert-dark"
        style={{ fontSize: 11.5, fontWeight: 600, border: "1px solid var(--color-accent-800)", color: "var(--color-accent-400)", padding: "7px 11px" }}
      >
        Remove this business
      </button>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--color-accent-800)", padding: 12 }}>
      <span style={{ fontSize: 12, color: "var(--color-neutral-300)", lineHeight: 1.5 }}>
        This deletes {name} and everything in it — its AI, knowledge, customers, conversations, leads and team. Type{" "}
        <b style={{ color: "var(--color-bg)" }}>{name}</b> to confirm.
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Business name" style={{ ...darkField, flex: 1 }} />
        <button
          type="button"
          disabled={pending || typed.trim().toLowerCase() !== name.trim().toLowerCase()}
          onClick={() => {
            setError(null);
            start(async () => {
              try {
                await onRemove(typed);
              } catch (e) {
                // A redirect is how success arrives; anything else is a failure.
                if (e && typeof e === "object" && "digest" in e && String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
                setError(errorText(e));
              }
            });
          }}
          style={{ fontSize: 11.5, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "0 12px" }}
        >
          {pending ? "Removing…" : "Remove"}
        </button>
        <button type="button" onClick={() => setOpen(false)} style={{ fontSize: 11.5, color: "var(--color-neutral-400)", padding: "0 6px" }}>
          Cancel
        </button>
      </div>
      {error && <span style={{ fontSize: 11.5, color: "var(--color-accent-400)" }}>{error}</span>}
    </div>
  );
}
