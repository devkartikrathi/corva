/**
 * Checks everything the agent needs before you rely on it.
 *
 * Each check prints what it found rather than just pass/fail, because the
 * failures that matter here are quiet ones — a wrong embedding width or an
 * un-normalised vector degrades retrieval without ever raising.
 */
import "./script-env";
import { sql } from "drizzle-orm";
import { EMBEDDING_DIMENSIONS, TURN_MODEL } from "@/lib/agent/model";
import { embedQuery } from "@/lib/agent/retrieval";
import { db } from "./index";
import * as s from "./schema";

const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => console.log(`  FAIL  ${m}`);

async function main() {
  let failures = 0;
  const fail = (m: string) => {
    bad(m);
    failures++;
  };

  console.log("\nDatabase");
  try {
    const res = await db.execute<{ version: string }>(sql`SELECT version()`);
    ok(res.rows[0].version.split(",")[0]);
  } catch (e) {
    fail(`cannot connect — ${(e as Error).message}`);
    console.log("\nStopping: nothing else can be checked without the database.\n");
    process.exit(1);
  }

  const extRes = await db.execute<{ extversion: string }>(
    sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  const ext = extRes.rows[0];
  ext ? ok(`pgvector ${ext.extversion}`) : fail("pgvector is not installed");

  const countRes = await db.execute<{ chunks: number; embedded: number }>(
    sql`SELECT count(*)::int AS chunks,
               count(embedding)::int AS embedded
        FROM document_chunks`,
  );
  const counts = countRes.rows[0];
  ok(`${counts.embedded} of ${counts.chunks} chunks embedded`);
  if (counts.chunks > 0 && counts.embedded === 0) {
    console.log("        run `npm run db:embed` — retrieval returns nothing until you do");
  }

  console.log("\nGemini");
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    fail("GOOGLE_GENERATIVE_AI_API_KEY is not set in .env.local");
    console.log("\nStopping: the model checks need a key.\n");
    process.exit(1);
  }
  ok("GOOGLE_GENERATIVE_AI_API_KEY is set");

  try {
    const vector = await embedQuery("a delivery was rescheduled three times");
    if (vector.length === EMBEDDING_DIMENSIONS) {
      ok(`embeddings return ${vector.length} dimensions`);
    } else {
      fail(`embeddings return ${vector.length}, expected ${EMBEDDING_DIMENSIONS}`);
    }

    // A truncated Gemini vector is not unit-length until we normalise it, and
    // an un-normalised index silently distorts every similarity.
    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
    Math.abs(norm - 1) < 1e-6
      ? ok(`vectors are normalised (‖v‖ = ${norm.toFixed(6)})`)
      : fail(`vectors are not normalised (‖v‖ = ${norm.toFixed(6)})`);
  } catch (e) {
    fail(`embedding call failed — ${(e as Error).message}`);
  }

  try {
    const { generateText } = await import("ai");
    const { text } = await generateText({
      model: TURN_MODEL,
      prompt: "Reply with the single word: ready",
    });
    ok(`turn model replied "${text.trim().slice(0, 20)}"`);
  } catch (e) {
    fail(`turn model call failed — ${(e as Error).message}`);
  }

  console.log("\nAgent configuration");
  const versions = await db
    .select({ brand: s.brands.name, version: s.agentVersions.version })
    .from(s.agentVersions)
    .innerJoin(s.brands, sql`${s.brands.id} = ${s.agentVersions.brandId}`)
    .where(sql`${s.agentVersions.status} = 'live'`);
  versions.length
    ? versions.forEach((v) => ok(`${v.brand}: agent v${v.version} live`))
    : fail("no brand has a live agent version");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
