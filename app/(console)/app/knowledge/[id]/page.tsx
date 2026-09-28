import Link from "next/link";
import { notFound } from "next/navigation";
import { Kicker, LinkAction, ScreenHeader, ScreenRefusal, Tag } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { DocumentEditor } from "@/components/DocumentEditor";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { can } from "@/lib/auth/permissions";
import {
  createDocument,
  getDocument,
  restoreRevision,
  setDocumentStatus,
  updateDocument,
} from "@/lib/actions/knowledge";
import { getKnowledge } from "@/lib/queries/workspace";

/**
 * One document.
 *
 * The editor sits above its own history, because the question people bring to
 * this screen is usually "what did this say when the AI quoted it" — and that
 * is answerable only if every published revision is kept.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, brand, denied } = await guardScreen("documents.publish");
  // The nav withholds this screen; this is what makes withholding it true.
  if (denied) {
    return (
      <ScreenRefusal
        title="Document"
        reason={refusalReason(denied)}
        next="Answers cite the document they came from, on every call in the archive."
      />
    );
  }

  const record = await getDocument(id).catch(() => null);
  if (!record) notFound();

  const { document: doc, revisions, chunks, citationCount } = record;
  const kb = await getKnowledge(brand.id);
  const decision = can(session.actor, "documents.publish", { brandId: brand.id });
  const indexed = chunks.filter((c) => c.embedding !== null).length;

  return (
    <section>
      <ScreenHeader
        kicker={`${doc.collection} · ${doc.kind} · revision ${doc.revision}`}
        title={doc.title}
        lede={
          doc.status === "published"
            ? `Live in retrieval. ${indexed} of ${chunks.length} chunk${chunks.length === 1 ? "" : "s"} indexed, cited ${citationCount} time${citationCount === 1 ? "" : "s"}.`
            : "Not published, so the agent cannot see it. Nothing here affects a live call yet."
        }
      >
        {decision.allowed && doc.status !== "published" && (
          <ActionButton
            variant="primary"
            pendingLabel="Publishing…"
            action={async () => {
              "use server";
              await setDocumentStatus(doc.id, "published");
            }}
          >
            Publish
          </ActionButton>
        )}
        {decision.allowed && doc.status === "published" && (
          <ActionButton
            variant="outline"
            pendingLabel="Withdrawing…"
            confirm="Withdraw this from retrieval? The agent will stop citing it immediately."
            action={async () => {
              "use server";
              await setDocumentStatus(doc.id, "archived");
            }}
          >
            Withdraw
          </ActionButton>
        )}
        <LinkAction href="/app/knowledge">← All documents</LinkAction>
      </ScreenHeader>

      <DocumentEditor
        documentId={doc.id}
        initial={{
          title: doc.title,
          collection: doc.collection,
          kind: doc.kind,
          body: doc.body,
          status: doc.status,
        }}
        collections={kb.collections.map((c) => c.name)}
        canPublish={decision.allowed}
        onSave={updateDocument}
        onCreate={createDocument}
      />

      <div style={{ borderTop: "2px solid var(--color-divider)", padding: "18px 24px" }}>
        <Kicker>History · {revisions.length} revision{revisions.length === 1 ? "" : "s"}</Kicker>
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10, maxWidth: 780 }}>
          {revisions.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                paddingBottom: 10,
                borderBottom: "1px solid var(--color-neutral-300)",
                fontSize: 12.5,
              }}
            >
              <b style={{ width: 34 }}>r{r.revision}</b>
              <span style={{ flex: 1 }}>
                {r.note ?? "No note"}
                <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                  {r.authorName ?? "Unknown"} ·{" "}
                  {r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </span>
              {r.revision === doc.revision ? (
                <Tag bg="var(--color-neutral-200)" fg="var(--color-neutral-800)" size={9.5} padding="3px 6px">
                  Current
                </Tag>
              ) : (
                decision.allowed && (
                  <ActionButton
                    variant="hairline"
                    pendingLabel="Restoring…"
                    confirm={`Restore revision ${r.revision}? It is saved as a new revision, so nothing is lost.`}
                    action={async () => {
                      "use server";
                      await restoreRevision(doc.id, r.revision);
                    }}
                  >
                    Restore
                  </ActionButton>
                )
              )}
            </div>
          ))}
        </div>
        <p style={{ marginTop: 14, fontSize: 11.5, color: "var(--color-neutral-700)", maxWidth: "62ch" }}>
          Restoring writes a new revision rather than rewinding, so a citation made against any
          earlier version still resolves to the text that was actually cited.{" "}
          <Link href={`/app/conversations?q=${encodeURIComponent(doc.title)}`} style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
            See where it has been used
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
