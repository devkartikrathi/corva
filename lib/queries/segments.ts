import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { config } from "@/lib/config";
import { toQuery, type Params } from "@/lib/params";
import { listCustomers } from "./customers";

/** The scoring model as the Segments screen shows it. */
export async function getScoringModel(brandId: string) {
  const [weightRows, ruleRows, segmentRows, alertRows, scoreRows, customerRows] = await Promise.all([
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
    db
      .select()
      .from(s.modelAlerts)
      .where(eq(s.modelAlerts.brandId, brandId))
      .orderBy(asc(s.modelAlerts.status), desc(s.modelAlerts.createdAt)),
    // Only the newest score per customer; the distribution is of the model as
    // it stands, not of every score it has ever produced.
    db
      .select({
        customerId: s.customerScores.customerId,
        blended: s.customerScores.blended,
        modelScore: s.customerScores.modelScore,
        overrideDelta: s.customerScores.overrideDelta,
        breakdown: s.customerScores.breakdown,
      })
      .from(s.customerScores)
      .innerJoin(s.customers, eq(s.customers.id, s.customerScores.customerId))
      .where(
        and(
          eq(s.customers.brandId, brandId),
          sql`${s.customerScores.computedAt} = (
            select max(cs.computed_at) from ${s.customerScores} cs
            where cs.customer_id = ${s.customerScores.customerId}
          )`,
        ),
      ),
    db.select().from(s.customers).where(eq(s.customers.brandId, brandId)),
  ]);

  /**
   * The distribution histogram.
   *
   * Twenty buckets of five points each, matching the design's bar count. Bars
   * above the accent threshold are drawn in accent, which is the whole point
   * of the chart: it shows how many customers a threshold change would sweep
   * into the priority queue.
   */
  const BUCKETS = 20;
  const buckets = Array.from({ length: BUCKETS }, () => 0);
  for (const row of scoreRows) {
    const index = Math.min(BUCKETS - 1, Math.floor(row.blended / (100 / BUCKETS)));
    buckets[index]++;
  }
  const peak = Math.max(1, ...buckets);
  const accentFrom = Math.floor(config.accentPriorityThreshold / (100 / BUCKETS));

  const distribution = buckets.map((count, i) => ({
    count,
    h: `${Math.round((count / peak) * 100)}%`,
    color: i >= accentFrom ? "var(--color-accent)" : "var(--color-neutral-400)",
    from: i * (100 / BUCKETS),
  }));

  /**
   * What the rules are actually doing.
   *
   * Read off the stored breakdowns rather than re-run, because the breakdown
   * is what the customer screens print — if this disagreed with them, one of
   * the two would be lying.
   */
  const withOverrides = scoreRows.filter((r) => r.overrideDelta !== 0);
  const firedByRule = new Map<string, number>();
  for (const row of scoreRows) {
    const breakdown = row.breakdown as { rules?: { name: string }[] };
    for (const rule of breakdown.rules ?? []) {
      firedByRule.set(rule.name, (firedByRule.get(rule.name) ?? 0) + 1);
    }
  }

  const abovePriority = scoreRows.filter((r) => r.blended >= config.accentPriorityThreshold).length;
  const aboveModelOnly = scoreRows.filter((r) => r.modelScore >= config.accentPriorityThreshold).length;
  const meanBlended = scoreRows.length
    ? scoreRows.reduce((a, r) => a + r.blended, 0) / scoreRows.length
    : 0;
  const meanModel = scoreRows.length
    ? scoreRows.reduce((a, r) => a + r.modelScore, 0) / scoreRows.length
    : 0;

  return {
    weights: weightRows
      .sort((a, b) => b.weight.weight - a.weight.weight)
      .map(({ weight, axis }) => ({
        key: axis.key,
        value: weight.weight,
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
        enabled: r.enabled,
        effectValue: r.effect,
        matches: `${firedByRule.get(r.name) ?? 0} of ${scoreRows.length}`,
        author: r.authorName ?? "—",
        hot: r.effect >= 14,
        tagBg: r.effect >= 14 ? "var(--color-accent-200)" : "var(--color-neutral-200)",
        tagFg: r.effect >= 14 ? "var(--color-accent-800)" : "var(--color-neutral-800)",
      };
    }),

    segments: await Promise.all(
      segmentRows.map(async (seg) => {
        // A segment is a stored filter, so its size is counted by running that
        // filter — the same code path the customer table runs.
        const query = ((seg.definition ?? {}) as { query?: Params }).query ?? {};
        const { total } = await listCustomers(brandId, {
          minScore: Number(query.minScore) || undefined,
          segment: query.segment ? query.segment.split(",") : undefined,
          tier: query.tier ? query.tier.split(",") : undefined,
          flag: query.flag ? query.flag.split(",") : undefined,
          owner: query.owner,
          pageSize: 1,
        });
        return {
          id: seg.id,
          name: seg.name,
          count: String(total),
          href: `/app/customers${toQuery(query)}`,
          owner: seg.ownerName ?? "shared",
        };
      }),
    ),

    distribution,

    /**
     * Model against model-plus-rules.
     *
     * The design called this "simulation"; what it is worth showing is the
     * difference the tenant's own rules make to a real population, which needs
     * no simulation at all — both numbers are already stored on every score.
     */
    simulation: [
      {
        label: "Customers scored",
        from: String(customerRows.length),
        to: String(scoreRows.length),
        hot: scoreRows.length < customerRows.length,
      },
      {
        label: `Above the priority threshold (${config.accentPriorityThreshold})`,
        from: String(aboveModelOnly),
        to: String(abovePriority),
        hot: abovePriority !== aboveModelOnly,
      },
      {
        label: "Mean score",
        from: meanModel.toFixed(1),
        to: meanBlended.toFixed(1),
        hot: Math.abs(meanBlended - meanModel) >= 2,
      },
      {
        label: "Customers a rule moved",
        from: "0",
        to: String(withOverrides.length),
        hot: withOverrides.length > 0,
      },
    ],

    alerts: alertRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      severity: a.severity,
      title: a.title,
      detail: a.detail,
      status: a.status,
      acknowledgedBy: a.acknowledgedByName,
      hot: a.severity === "critical" && a.status === "open",
      open: a.status === "open",
    })),

    scoredCount: scoreRows.length,
    customerCount: customerRows.length,
  };
}
