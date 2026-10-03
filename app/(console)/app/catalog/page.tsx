import Link from "next/link";
import { ScreenRefusal, ScreenTitle } from "@/components/ui";
import { CatalogEditor } from "@/components/CatalogEditor";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { can } from "@/lib/auth/permissions";
import { catalogDocument, catalogOutline, loadCatalog } from "@/lib/catalog";

/**
 * Products & services: what the business sells, with prices.
 *
 * The list the AI quotes from on chat, calls, email and WhatsApp. Groups nest
 * as deep as the business needs; each item has a price, the unit it is quoted
 * in, and a description in the business's own words.
 */
export default async function CatalogPage() {
  const { session, brand, denied } = await guardScreen("documents.publish");
  if (denied) {
    return (
      <ScreenRefusal
        title="Products & services"
        reason={refusalReason(denied)}
        next="The AI quotes prices from this list on every channel."
      />
    );
  }

  const [catalog, doc] = await Promise.all([loadCatalog(brand.id), catalogDocument(brand.id)]);
  const editable = can(session.actor, "documents.publish", { brandId: brand.id }).allowed;
  const agent = brand.agentName ?? "The AI";
  const outline = catalogOutline(catalog);

  return (
    <section style={{ padding: "20px 24px", maxWidth: 1080 }}>
      <ScreenTitle
        kicker={`${brand.name} · ${catalog.itemCount} item${catalog.itemCount === 1 ? "" : "s"} in ${catalog.groupCount} group${catalog.groupCount === 1 ? "" : "s"}`}
        title="Products & services"
      />
      <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "72ch", lineHeight: 1.5 }}>
        What you sell and what it costs. {agent} answers from this list on chat, calls, email and WhatsApp — it quotes
        the prices exactly and says when something is not available. For anything marked “on request” it gives a
        figure only if your knowledge base has one. A change here is in the next answer.
        {!editable && " You can see this list; changing it needs a Manager."}
      </p>

      <div style={{ marginTop: 20 }}>
        <CatalogEditor groups={catalog.groups} loose={catalog.loose} editable={editable} agentName={agent} />
      </div>

      {outline && (
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
            {outline}
          </pre>
          {doc && (
            <p style={{ marginTop: 8, fontSize: 11.5, color: "var(--color-neutral-700)" }}>
              Full descriptions are searchable in the knowledge base as{" "}
              <Link href={`/app/knowledge/${doc.id}`} style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                {doc.title}
              </Link>
              , which is written from this list.
            </p>
          )}
        </details>
      )}
    </section>
  );
}
