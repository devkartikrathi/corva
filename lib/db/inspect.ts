/** Prints the current score of every customer with its arithmetic. */
import "./script-env";
import { desc, eq } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

async function main() {
  const rows = await db
    .select({
      name: s.customers.name,
      blended: s.customerScores.blended,
      model: s.customerScores.modelScore,
      delta: s.customerScores.overrideDelta,
      breakdown: s.customerScores.breakdown,
    })
    .from(s.customerScores)
    .innerJoin(s.customers, eq(s.customers.id, s.customerScores.customerId))
    .orderBy(desc(s.customerScores.blended));

  for (const r of rows) {
    const b = r.breakdown as {
      contributions?: { axisLabel: string; contribution: number }[];
      rules?: { name: string }[];
    };
    const rules = (b.rules ?? []).map((x) => x.name).join(", ") || "—";
    const top = (b.contributions ?? [])
      .slice(0, 3)
      .map((c) => `${c.axisLabel} ${c.contribution}`)
      .join(", ");
    console.log(
      `${String(r.blended).padStart(3)}  ${r.name.padEnd(24)} model ${String(r.model).padStart(5)} ${r.delta >= 0 ? "+" : ""}${r.delta}  [${rules}]`,
    );
    console.log(`     ${top}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
