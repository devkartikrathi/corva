import { ScreenRefusal, ScreenTitle } from "@/components/ui";
import { DataSource } from "@/components/DataSource";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { sealingReady } from "@/lib/data/crypto";
import { lookupsFor, sourceFor } from "@/lib/data/sources";
import {
  askDatabase,
  connectDatabase,
  disconnectDatabase,
  refreshDatabase,
  removeDataLookup,
  saveDataLookup,
  suggestDataLookups,
  testDataLookup,
} from "@/lib/actions/data";

/**
 * Your database: the business's own records, connected to its assistant.
 *
 * Corva does not copy the data. It keeps the connection, reads the table
 * names, and looks things up when someone asks — a customer through a lookup
 * the business approved, or the team in their own words.
 */
export default async function DataPage() {
  const { brand, denied } = await guardScreen("people.manage");
  if (denied) {
    return (
      <ScreenRefusal
        title="Your database"
        reason={refusalReason(denied)}
        next="An owner or admin can connect the business's database and choose what the assistant may look up."
      />
    );
  }

  const [source, lookups] = await Promise.all([sourceFor(brand.id), lookupsFor(brand.id)]);
  const agent = brand.agentName ?? "The AI";

  return (
    <section style={{ padding: "20px 24px", maxWidth: 1080 }}>
      <ScreenTitle kicker={`${brand.name} · ${agent}`} title="Your database" />
      <p style={{ marginTop: 12, fontSize: 13, color: "var(--color-neutral-800)", maxWidth: "72ch", lineHeight: 1.5 }}>
        Connect the database your business already runs on, and {agent} can answer from it live — where an order
        has got to, when a booking is, what is owed. Nothing is copied into Corva: it reads when someone asks, and
        it can only read. Customers get the lookups you approve below and nothing else; your team can ask anything.
      </p>

      <div style={{ marginTop: 20 }}>
        <DataSource
          ready={sealingReady()}
          agentName={agent}
          source={
            source
              ? {
                  name: source.name,
                  host: source.host,
                  database: source.databaseName,
                  tables: source.snapshot.tables.map((t) => ({
                    name: t.schema === "public" ? t.name : `${t.schema}.${t.name}`,
                    columns: t.columns.map((c) => c.name),
                  })),
                  checked: source.lastCheckedAt
                    ? source.lastCheckedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
                    : null,
                  error: source.lastError,
                }
              : null
          }
          lookups={lookups}
          actions={{
            connect: connectDatabase,
            refresh: refreshDatabase,
            disconnect: disconnectDatabase,
            save: saveDataLookup,
            remove: removeDataLookup,
            test: testDataLookup,
            suggest: suggestDataLookups,
            ask: askDatabase,
          }}
        />
      </div>
    </section>
  );
}
