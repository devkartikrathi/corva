import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/** The scoring model as the Segments screen shows it. */
export async function getScoringModel(brandId: string) {
  const [weightRows, ruleRows, segmentRows] = await Promise.all([
    db
      .select({ weight: s.brandAxisWeights, axis: s.scoringAxes })
      .from(s.brandAxisWeights)
      .innerJoin(s.scoringAxes, eq(s.scoringAxes.key, s.brandAxisWeights.axisKey))
      .where(eq(s.brandAxisWeights.brandId, brandId)),
    db
      .select()
      .from(s.priorityRules)
      .where(eq(s.priorityRules.brandId, brandId))
      .orderBy(asc(s.priorityRules.ordinal)),
    db.select().from(s.segments).where(eq(s.segments.brandId, brandId)),
  ]);

  return {
    weights: weightRows
      .sort((a, b) => b.weight.weight - a.weight.weight)
      .map(({ weight, axis }) => ({
        label: axis.label,
        weight: weight.weight.toFixed(2),
        bar: `${Math.round(weight.weight * 100)}%`,
        source: axis.source,
        color: weight.weight >= 0.75 ? "var(--color-accent)" : "var(--color-neutral-700)",
      })),

    rules: ruleRows.map((r) => {
      const condition = (r.condition ?? {}) as { all?: { field: string; op: string; value: unknown }[] };
      const OP: Record<string, string> = {
        eq: "=", contains: "contains", gte: "≥", lte: "≤", gt: ">", lt: "<",
      };
      return {
        id: r.id,
        name: r.name,
        effect: `${r.effect >= 0 ? "+" : ""}${r.effect}`,
        // Render the stored AST rather than a second copy of the sentence.
        condition: (condition.all ?? [])
          .map((c) => `${c.field.replace(/_/g, " ")} ${OP[c.op] ?? c.op} ${c.value}`)
          .join(" AND "),
        action: ((r.actions ?? []) as { kind: string }[])
          .map((a) => a.kind.replace(/_/g, " "))
          .join(", ") || "adjust priority",
        matches: r.enabled ? "enabled" : "disabled",
        author: r.authorName ?? "—",
        hot: r.effect >= 14,
        tagBg: r.effect >= 14 ? "var(--color-accent-200)" : "var(--color-neutral-200)",
        tagFg: r.effect >= 14 ? "var(--color-accent-800)" : "var(--color-neutral-800)",
      };
    }),

    segments: segmentRows.map((seg) => ({
      id: seg.id,
      name: seg.name,
      count: String((seg.definition as { estimatedCount?: number })?.estimatedCount ?? "—"),
      owner: seg.ownerName ?? "shared",
    })),
  };
}
