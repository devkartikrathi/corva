import { and, eq, isNull, sql } from "drizzle-orm";
import { after } from "next/server";
import { embedDocuments } from "@/lib/agent/retrieval";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Turning a document into something the agent can retrieve.
 *
 * Not a server action module on purpose: these are called by actions (the
 * Knowledge screen) and by onboarding, and anything exported from a
 * "use server" file is a public endpoint.
 */

/**
 * Split a document into retrievable pieces.
 *
 * Paragraphs, because that is how policies are written and how they are
 * quoted back — a fixed token window would cut "the agent may apply up to
 * ₹5,000" away from the condition that qualifies it.
 */
export function chunk(body: string): { anchor: string | null; content: string }[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return paragraphs.map((content, i) => {
    // A leading "§3.2" or "Reschedules:" becomes the anchor a citation prints.
    const match = content.match(/^(§[\d.]+|[A-Z][A-Za-z \-&]{2,28})[:—-]\s/);
    return {
      anchor: match ? match[1].trim() : `¶${i + 1}`,
      content,
    };
  });
}

/**
 * Rewrite a document's chunks and embed them.
 *
 * Embedding is what costs time here, so it happens once for the whole document
 * rather than per chunk. If it throws, the old chunks are already gone — which
 * is the right failure: an empty document retrieves nothing, while a
 * half-updated one retrieves the wrong thing and says nothing is wrong.
 */
export async function reindex(documentId: string, brandId: string, body: string) {
  return writeChunks(documentId, brandId, chunk(body));
}

/**
 * Replace a document's chunks with these pieces, embedded.
 *
 * Embedding is what costs time here, so it happens once for the whole document
 * rather than per chunk. If it throws, the chunks are stored without vectors —
 * an empty document retrieves nothing, while a half-updated one retrieves the
 * wrong thing and says nothing is wrong.
 *
 * `reuse` keeps the vector of any piece whose text has not changed, which is
 * what lets a catalog of hundreds of items be re-written on every edit without
 * embedding hundreds of lines each time. Off for documents, so the Re-index
 * button still means "embed this again".
 *
 * The delete and the insert run as one transaction behind a per-document lock,
 * so two saves landing together cannot leave both sets of chunks behind.
 */
export async function writeChunks(
  documentId: string,
  brandId: string,
  pieces: { anchor: string | null; content: string }[],
  { reuse = false }: { reuse?: boolean } = {},
) {
  const known = new Map<string, number[]>();
  if (reuse && pieces.length > 0) {
    const existing = await db
      .select({ content: s.documentChunks.content, embedding: s.documentChunks.embedding })
      .from(s.documentChunks)
      .where(eq(s.documentChunks.documentId, documentId));
    for (const c of existing) if (c.embedding) known.set(c.content, c.embedding);
  }

  // What the shared allowance has room for is embedded now; the rest is
  // stored without vectors and embedded in the background (`embedLater`).
  // Until then retrieval matches those chunks by their words, so nothing
  // written here is unreachable — a price list of three hundred lines is
  // searchable the moment it is saved, and properly indexed minutes later.
  const fresh = [...new Set(pieces.map((p) => p.content).filter((c) => !known.has(c)))];
  if (fresh.length > 0) {
    const now = fresh.slice(0, await takeEmbedAllowance(fresh.length));
    if (now.length > 0) {
      try {
        const vectors = await embedDocuments(now);
        now.forEach((content, i) => known.set(content, vectors[i]));
      } catch (e) {
        await spendEmbedAllowance();
        console.error("embedding failed, storing chunks unembedded:", (e as Error).message);
      }
    }
  }

  const lock = db.execute(sql`select pg_advisory_xact_lock(hashtext(${documentId}))`);
  const clear = db.delete(s.documentChunks).where(eq(s.documentChunks.documentId, documentId));
  if (pieces.length === 0) {
    await db.batch([lock, clear]);
    return 0;
  }
  await db.batch([
    lock,
    clear,
    db.insert(s.documentChunks).values(
      pieces.map((p, i) => ({
        documentId,
        brandId,
        ordinal: i,
        anchor: p.anchor,
        content: p.content,
        embedding: known.get(p.content) ?? null,
      })),
    ),
  ]);
  if (pieces.some((p) => !known.has(p.content))) embedLater(brandId);
  return pieces.length;
}

/* ─── Embedding at the pace the provider allows ────────────────────────── */

/**
 * Embeddings a minute, across every instance of Corva.
 *
 * Gemini's free tier allows 100 in any rolling minute per project, and every
 * customer question spends one on retrieval — so background work takes about
 * this many and leaves the rest for the people waiting on an answer. Raise it
 * with EMBEDDINGS_PER_MINUTE on a paid tier.
 *
 * Handed out in ten-second slices rather than per clock minute: the provider's
 * minute rolls, and a full minute's allowance spent at 10:00:59 and another at
 * 10:01:00 is twice the limit inside one of its minutes. With slices, any
 * rolling minute holds at most seven of them — 70 at the default.
 */
const PER_MINUTE = Math.max(6, Number(process.env.EMBEDDINGS_PER_MINUTE) || 60);
const SLICE_MS = 10_000;
const PER_SLICE = Math.ceil(PER_MINUTE / 6);
const ALLOWANCE_KEY = "embeddings";

const sliceStart = (at = Date.now()) => new Date(Math.floor(at / SLICE_MS) * SLICE_MS);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Take up to `wanted` embeddings from this slice's allowance; returns how
 * many were granted. Counted in `rate_limits`, so two instances embedding at
 * once share one allowance rather than each spending a full one.
 */
async function takeEmbedAllowance(wanted: number): Promise<number> {
  try {
    const [row] = await db
      .insert(s.rateLimits)
      .values({ key: ALLOWANCE_KEY, windowStart: sliceStart(), count: wanted })
      .onConflictDoUpdate({
        target: [s.rateLimits.key, s.rateLimits.windowStart],
        set: { count: sql`${s.rateLimits.count} + ${wanted}` },
      })
      .returning({ count: s.rateLimits.count });
    const before = row.count - wanted;
    return Math.max(0, Math.min(wanted, PER_SLICE - before));
  } catch (e) {
    // Without the counter, a small amount rather than none: a failed edit is
    // worse than one that lands slightly over the provider's limit.
    console.error("[embeddings] allowance", (e as Error).message);
    return Math.min(wanted, PER_SLICE);
  }
}

/** The provider refused: nobody else embeds in this slice. */
async function spendEmbedAllowance() {
  await takeEmbedAllowance(PER_SLICE).catch(() => undefined);
}

/** After a refusal, how long a background run waits before asking again. */
const COOL_DOWN_MS = 30_000;

/**
 * Embed chunks stored without a vector, a slice's allowance at a time.
 *
 * Runs until there is nothing left or `until` would be passed while waiting
 * for more allowance; whatever is left is picked up by the next run. Safe to
 * run alongside itself — the allowance is shared, and a chunk replaced while
 * its vector was being made simply no longer matches the update.
 */
export async function embedPending({ brandId, until }: { brandId?: string; until: number }) {
  let embedded = 0;
  for (;;) {
    const pending = await db
      .select({ id: s.documentChunks.id, content: s.documentChunks.content })
      .from(s.documentChunks)
      .where(and(isNull(s.documentChunks.embedding), brandId ? eq(s.documentChunks.brandId, brandId) : undefined))
      .limit(PER_SLICE);
    if (pending.length === 0) return { embedded, left: 0 };

    const granted = await takeEmbedAllowance(pending.length);
    let wait = sliceStart().getTime() + SLICE_MS + 250 - Date.now();
    if (granted > 0) {
      const batch = pending.slice(0, granted);
      try {
        const vectors = await embedDocuments(batch.map((c) => c.content));
        const [first, ...rest] = batch.map((c, i) =>
          db.update(s.documentChunks).set({ embedding: vectors[i] }).where(eq(s.documentChunks.id, c.id)),
        );
        await db.batch([first, ...rest]);
        embedded += batch.length;
        continue;
      } catch (e) {
        console.error("[embeddings] pending", (e as Error).message.slice(0, 200));
        await spendEmbedAllowance();
        wait = COOL_DOWN_MS;
      }
    }

    // Out of allowance for now: wait for more, if there is time.
    if (Date.now() + wait > until) {
      const [left] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.documentChunks)
        .where(and(isNull(s.documentChunks.embedding), brandId ? eq(s.documentChunks.brandId, brandId) : undefined));
      return { embedded, left: left.n };
    }
    await sleep(wait);
  }
}

/**
 * Finish a brand's embeddings after the response has gone.
 *
 * A function may run for five minutes, so this is a few minutes' allowance
 * — about 250 chunks at the default pace. Anything larger is finished by the
 * scheduled job, or the next time this is called. Outside a request (a
 * script) there is nothing to run after, and the scheduled job picks it up.
 */
export function embedLater(brandId: string) {
  try {
    after(() =>
      embedPending({ brandId, until: Date.now() + 250_000 }).catch((e) =>
        console.error("[embeddings] later", (e as Error).message),
      ),
    );
  } catch {
    // Not in a request.
  }
}
