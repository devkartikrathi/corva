/**
 * Make an API key for a business from the command line — the same as
 * Settings → Website & API keys, for setting a site up before anyone signs in.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/create-api-key.ts tumble-days "Website"
 *
 * Prints the key once. Only its hash is stored.
 */
import "../lib/db/script-env";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";
import { createApiKey } from "../lib/integrations/keys";

async function main() {
  const [slug, name = "Website"] = process.argv.slice(2);
  if (!slug) throw new Error("Pass the business's brand slug, e.g. tumble-days.");
  const [brand] = await db.select().from(s.brands).where(eq(s.brands.slug, slug)).limit(1);
  if (!brand) throw new Error(`No business with brand slug ${slug}.`);
  const { key } = await createApiKey(brand.id, name, "Command line");
  console.log(key);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
