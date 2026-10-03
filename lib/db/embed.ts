/**
 * Embeds every document chunk that does not yet have a vector.
 *
 * Safe to re-run: it only touches rows where `embedding IS NULL`. Paced by the
 * same shared allowance as the app (lib/knowledge), so it can run beside live
 * traffic without spending the provider's per-minute limit out from under it
 * — a large backlog takes a few minutes rather than failing.
 */
import "./script-env";
import { sql } from "drizzle-orm";
import { embedPending } from "@/lib/knowledge";
import { db } from "./index";
import * as s from "./schema";

async function main() {
  const { embedded } = await embedPending({ until: Number.POSITIVE_INFINITY });
  console.log(embedded ? `Embedded ${embedded} chunks.` : "Nothing to embed — every chunk already has a vector.");

  // An IVFFlat index only pays off once there are vectors to organise.
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(s.documentChunks);
  if (count >= 1000) {
    await db.execute(
      sql`CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
          ON document_chunks USING ivfflat (embedding vector_cosine_ops)
          WITH (lists = 100)`,
    );
    console.log("Created the IVFFlat index.");
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
