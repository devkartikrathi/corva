"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/**
 * Writing what the AI is allowed to say.
 *
 * Two things this makes visible that a plain form would not. First, the body
 * is split into retrievable chunks on blank lines, and the preview shows that
 * split as you type — a policy written as one wall of text retrieves as one
 * wall of text, and the person writing it should see that before publishing.
 * Second, publishing and saving are separate buttons, because a draft is
 * invisible to the agent and that is a decision, not a side effect.
 */
export function DocumentEditor({
  documentId,
  initial,
  collections,
  canPublish,
  onSave,
  onCreate,
}: {
  documentId: string | null;
  initial: { title: string; collection: string; kind: string; body: string; status: string };
  collections: string[];
  canPublish: boolean;
  onSave: (
    documentId: string,
    input: { title: string; collection: string; kind: string; body: string; note?: string },
  ) => Promise<unknown>;
  onCreate: (input: {
    title: string;
    collection: string;
    kind: string;
    body: string;
    publish: boolean;
  }) => Promise<string>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial.title);
  const [collection, setCollection] = useState(initial.collection);
  const [kind, setKind] = useState(initial.kind);
  const [body, setBody] = useState(initial.body);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  // The same split the server does, so the preview is not a separate guess.
  const chunks = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const dirty =
    title !== initial.title ||
    collection !== initial.collection ||
    kind !== initial.kind ||
    body !== initial.body;

  const run = (publish: boolean) => {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        if (documentId) {
          await onSave(documentId, { title, collection, kind, body, note });
          setNote("");
          setSaved(true);
        } else {
          const id = await onCreate({ title, collection, kind, body, publish });
          router.push(`/app/knowledge/${id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message.replace(/^Error:\s*/, "") : "Failed to save.");
      }
    });
  };

  const field: React.CSSProperties = {
    border: "1px solid var(--color-neutral-400)",
    background: "var(--color-surface)",
    padding: "8px 10px",
    fontSize: 12.5,
    fontFamily: "inherit",
    color: "var(--color-text)",
    borderRadius: 0,
    width: "100%",
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24, padding: "20px 24px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "block" }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-neutral-700)",
            }}
          >
            Title
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Service promise v5"
            style={{ ...field, marginTop: 6, fontSize: 16, fontWeight: 700 }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              Collection
            </span>
            <input
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              list="collections"
              placeholder="Service promises"
              style={{ ...field, marginTop: 6 }}
            />
            <datalist id="collections">
              {collections.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              Kind
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              style={{ ...field, marginTop: 6 }}
            >
              {["Policy", "Playbook", "Reference", "Product", "Guide"].map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-neutral-700)",
            }}
          >
            Text · a blank line starts a new retrievable chunk
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={22}
            placeholder={
              "Where a delivery has been rescheduled twice or more, the customer qualifies for a goodwill credit. The agent may apply up to ₹5,000 without approval.\n\nGoodwill credits are applied to the original payment method within five working days."
            }
            style={{ ...field, marginTop: 6, lineHeight: 1.6, resize: "vertical" }}
          />
        </label>

        {documentId && (
          <label>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--color-neutral-700)",
              }}
            >
              What changed
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Raised the goodwill ceiling to ₹5,000"
              style={{ ...field, marginTop: 6 }}
            />
          </label>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            className="hov-accent"
            disabled={pending || !title.trim() || (documentId !== null && !dirty)}
            onClick={() => run(true)}
            style={{
              fontSize: 12,
              fontWeight: 700,
              background:
                pending || !title.trim() || (documentId !== null && !dirty)
                  ? "var(--color-neutral-400)"
                  : "var(--color-accent)",
              color: "var(--color-bg)",
              padding: "10px 16px",
            }}
          >
            {pending
              ? "Saving…"
              : documentId
                ? initial.status === "published"
                  ? "Save and re-index"
                  : "Save draft"
                : canPublish
                  ? "Create and publish"
                  : "Create draft"}
          </button>
          {!documentId && canPublish && (
            <button
              type="button"
              className="hov-invert"
              disabled={pending || !title.trim()}
              onClick={() => run(false)}
              style={{
                fontSize: 12,
                fontWeight: 600,
                border: "2px solid var(--color-text)",
                padding: "9px 14px",
              }}
            >
              Save as draft
            </button>
          )}
          {saved && (
            <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              Saved
              {initial.status === "published" ? " and re-indexed." : "."}
            </span>
          )}
          {error && (
            <span role="alert" style={{ fontSize: 11.5, color: "var(--color-accent-700)" }}>
              {error}
            </span>
          )}
        </div>
      </div>

      <aside>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--color-neutral-700)",
          }}
        >
          Retrieval preview · {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
        </div>
        <p style={{ margin: "8px 0 12px", fontSize: 11.5, color: "var(--color-neutral-700)", lineHeight: 1.45 }}>
          Each block below is embedded separately and cited on its own. One long block retrieves as
          one long block — split a policy where a reader would.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {chunks.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--color-neutral-700)" }}>
              Nothing to index yet.
            </span>
          )}
          {chunks.map((c, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--color-neutral-300)",
                background: "var(--color-surface)",
                padding: "8px 10px",
                fontSize: 11.5,
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: "var(--color-neutral-700)", fontWeight: 700 }}>¶{i + 1}</span>{" "}
              {c.length > 220 ? `${c.slice(0, 220)}…` : c}
              {c.length > 900 && (
                <span style={{ display: "block", marginTop: 4, color: "var(--color-accent-700)", fontWeight: 600 }}>
                  Long — consider splitting this one.
                </span>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
