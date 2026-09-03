/** Recomputes every brand's customer scores. Run after seeding or a model change. */
import "./script-env";
import { rescoreBrand } from "@/lib/queries/scoring";
import { db } from "./index";
import * as s from "./schema";

async function main() {
  const brands = await db.select().from(s.brands);
  for (const brand of brands) {
    const n = await rescoreBrand(brand.id);
    console.log(`${brand.name}: scored ${n} customers`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
