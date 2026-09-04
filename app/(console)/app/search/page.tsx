import Link from "next/link";
import { Kicker, ScreenTitle } from "@/components/ui";
import { SearchBox } from "@/components/filters";
import { getConsoleContext } from "@/lib/auth/context";
import { normalise, type RawParams } from "@/lib/params";
import { search, searchScope, type SearchHit } from "@/lib/queries/search";

/**
 * Search results.
 *
 * A page rather than a dropdown: the results are grouped, each one carries
 * enough context to choose between two customers with the same surname, and
 * the whole thing is linkable. The top bar's box is a GET form pointing here.
 */

const GROUPS = [
  { key: "customers", label: "Customers" },
  { key: "conversations", label: "Conversations" },
  { key: "documents", label: "Documents" },
  { key: "people", label: "People" },
] as const;

export default async function SearchPage({ searchParams }: { searchParams: Promise<RawParams> }) {
  const { session, brand } = await getConsoleContext();
  const params = normalise(await searchParams);
  const term = params.q ?? "";

  const [results, scope] = await Promise.all([
    search({ brandId: brand.id, orgId: session.orgId }, term),
    searchScope(brand.id, session.orgId),
  ]);

  const ctx = { pathname: "/app/search", params };

  return (
    <section>
      <div style={{ padding: "20px 24px", borderBottom: "2px solid var(--color-divider)" }}>
        <ScreenTitle
          kicker={`${brand.name} · ${scope.customers} customers, ${scope.conversations} conversations, ${scope.documents} documents`}
          title={term ? `“${term}”` : "Search"}
        />
        <div style={{ marginTop: 16, maxWidth: 460 }}>
          <SearchBox ctx={ctx} placeholder="Search customers, calls, documents, people" />
        </div>
      </div>

      {term.trim().length < 2 ? (
        <p style={{ padding: "40px 24px", fontSize: 13, color: "var(--color-neutral-700)", maxWidth: "56ch" }}>
          Type at least two characters. Conversations are searched by their transcript as well
          as their intent, so a phrase you remember from a call will find it.
        </p>
      ) : results.total === 0 ? (
        <p style={{ padding: "40px 24px", fontSize: 13, color: "var(--color-neutral-700)", maxWidth: "56ch" }}>
          Nothing in {brand.name} matches “{term}”. Search is scoped to the brand in view —
          another brand in this workspace may still have it.
        </p>
      ) : (
        <div style={{ padding: "0 24px 40px" }}>
          {GROUPS.map((group) => {
            const hits = results[group.key];
            if (hits.length === 0) return null;
            return (
              <div key={group.key} style={{ marginTop: 28 }}>
                <Kicker>
                  {group.label} · {hits.length}
                </Kicker>
                <div style={{ marginTop: 10, border: "1px solid var(--color-neutral-300)" }}>
                  {hits.map((hit, i) => (
                    <Row key={hit.href + i} hit={hit} first={i === 0} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Row({ hit, first }: { hit: SearchHit; first: boolean }) {
  return (
    <Link
      href={hit.href}
      className="hov-raise"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 12,
        padding: "11px 14px",
        borderTop: first ? undefined : "1px solid var(--color-neutral-300)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 220 }}>{hit.title}</span>
      <span style={{ flex: 1, fontSize: 12, color: "var(--color-neutral-700)" }}>{hit.detail}</span>
      {hit.aside && (
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-neutral-800)" }}>
          {hit.aside}
        </span>
      )}
    </Link>
  );
}
