import { ScreenHeader } from "@/components/ui";
import { DocumentEditor } from "@/components/DocumentEditor";
import { getConsoleContext } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { createDocument, updateDocument } from "@/lib/actions/knowledge";
import { getKnowledge } from "@/lib/queries/workspace";

export default async function NewDocumentPage() {
  const { session, brand } = await getConsoleContext();
  const kb = await getKnowledge(brand.id);
  const decision = can(session.actor, "documents.publish", { brandId: brand.id });

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · new document`}
        title="Write a document"
        lede={
          decision.allowed
            ? "Published documents are what the agent may answer from. Nothing else is."
            : "Your role can draft documents; a Manager publishes them."
        }
      />
      <DocumentEditor
        documentId={null}
        initial={{ title: "", collection: "", kind: "Policy", body: "", status: "draft" }}
        collections={kb.collections.map((c) => c.name)}
        canPublish={decision.allowed}
        onSave={updateDocument}
        onCreate={createDocument}
      />
    </section>
  );
}
