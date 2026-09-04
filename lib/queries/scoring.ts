import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * The scoring engine.
 *
 * A customer's priority is a weighted blend of their signals, plus the
 * attributed overrides the tenant's rules contribute. The design's promise is
 * that you can "hover any score and get the arithmetic" — so this returns the
 * contributions, not just the total, and every score is written as a new
 * timestamped row rather than an update.
 */

export type Contribution = {
  axisKey: string;
  axisLabel: string;
  value: number;
  weight: number;
  contribution: number;
  /** Why this axis moved the number, in the tenant's language. */
  note: string | null;
};

export type RuleContribution = {
  ruleId: string;
  name: string;
  effect: number;
  authorName: string | null;
};

export type Score = {
  modelScore: number;
  overrideDelta: number;
  blended: number;
  contributions: Contribution[];
  rules: RuleContribution[];
};

type RuleCondition = {
  all?: { field: string; op: string; value: unknown }[];
};

/** Facts a rule can test. Assembled once per customer, not per rule. */
export type RuleFacts = {
  tier: string | null;
  segment: string | null;
  ltvPence: number;
  daysSinceContact: number | null;
  contacts30d: number;
  serviceFailures90d: number;
  renewalDays: number | null;
  intent: string | null;
};

function testCondition(condition: RuleCondition, facts: RuleFacts): boolean {
  const clauses = condition.all ?? [];
  if (clauses.length === 0) return false;

  return clauses.every(({ field, op, value }) => {
    const actual = (facts as Record<string, unknown>)[toCamel(field)];
    if (actual === null || actual === undefined) return false;

    switch (op) {
      case "eq":
        return String(actual).toLowerCase() === String(value).toLowerCase();
      case "contains":
        return String(actual).toLowerCase().includes(String(value).toLowerCase());
      case "gte":
        return Number(actual) >= Number(value);
      case "lte":
        return Number(actual) <= Number(value);
      case "gt":
        return Number(actual) > Number(value);
      case "lt":
        return Number(actual) < Number(value);
      default:
        return false;
    }
  });
}

const toCamel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Compute one customer's score.
 *
 * Every axis is oriented so that upward means "needs attention" before it is
 * weighted. Note that this is not the same as inverting good news: a high
 * lifetime value raises priority because there is more at stake, while high
 * sentiment lowers it. The `inverted` flag on the axis says which is which.
 */
export function computeScore(
  signals: { axisKey: string; axisLabel: string; value: number; inverted: boolean }[],
  weights: Map<string, number>,
  rules: { id: string; name: string; condition: unknown; effect: number; authorName: string | null }[],
  facts: RuleFacts,
): Score {
  const contributions: Contribution[] = [];
  let weighted = 0;
  let totalWeight = 0;

  for (const signal of signals) {
    const weight = weights.get(signal.axisKey);
    if (weight === undefined) continue;

    const oriented = signal.inverted ? 100 - signal.value : signal.value;
    weighted += oriented * weight;
    totalWeight += weight;

    contributions.push({
      axisKey: signal.axisKey,
      axisLabel: signal.axisLabel,
      value: signal.value,
      weight,
      contribution: oriented * weight,
      note: null,
    });
  }

  const modelScore = totalWeight > 0 ? weighted / totalWeight : 0;

  const fired: RuleContribution[] = [];
  let overrideDelta = 0;
  for (const rule of rules) {
    if (testCondition((rule.condition ?? {}) as RuleCondition, facts)) {
      overrideDelta += rule.effect;
      fired.push({
        ruleId: rule.id,
        name: rule.name,
        effect: rule.effect,
        authorName: rule.authorName,
      });
    }
  }

  // Normalise the contributions onto the final number so the breakdown adds up
  // to what the screen prints.
  const blended = Math.max(0, Math.min(100, modelScore + overrideDelta));
  const scale = modelScore > 0 ? modelScore / (weighted / (totalWeight || 1)) : 1;
  for (const c of contributions) {
    c.contribution = Math.round((c.contribution / (totalWeight || 1)) * scale * 10) / 10;
  }
  contributions.sort((a, b) => b.contribution - a.contribution);

  return {
    modelScore: Math.round(modelScore * 10) / 10,
    overrideDelta,
    blended: Math.round(blended),
    contributions,
    rules: fired,
  };
}

/** Recompute and persist scores for every customer of a brand. */
export async function rescoreBrand(brandId: string): Promise<number> {
  const [axes, weightRows, ruleRows, customers] = await Promise.all([
    db.select().from(s.scoringAxes),
    db.select().from(s.brandAxisWeights).where(eq(s.brandAxisWeights.brandId, brandId)),
    db
      .select()
      .from(s.priorityRules)
      .where(and(eq(s.priorityRules.brandId, brandId), eq(s.priorityRules.enabled, true))),
    db.select().from(s.customers).where(eq(s.customers.brandId, brandId)),
  ]);

  if (customers.length === 0) return 0;

  const axisByKey = new Map(axes.map((a) => [a.key, a]));
  const weights = new Map(weightRows.map((w) => [w.axisKey, w.weight]));

  const signalRows = await db
    .select()
    .from(s.customerSignals)
    .where(inArray(s.customerSignals.customerId, customers.map((c) => c.id)));

  // Rule facts come from the conversation history, not from constants — a
  // rule that never fires because its inputs are stubbed is worse than no rule.
  const convRows = await db
    .select({
      customerId: s.conversations.customerId,
      startedAt: s.conversations.startedAt,
      outcome: s.conversations.outcome,
      intent: s.conversations.intent,
    })
    .from(s.conversations)
    .where(eq(s.conversations.brandId, brandId));

  const historyByCustomer = new Map<string, typeof convRows>();
  for (const row of convRows) {
    if (!row.customerId) continue;
    const list = historyByCustomer.get(row.customerId) ?? [];
    list.push(row);
    historyByCustomer.set(row.customerId, list);
  }

  const signalsByCustomer = new Map<string, typeof signalRows>();
  for (const row of signalRows) {
    const list = signalsByCustomer.get(row.customerId) ?? [];
    list.push(row);
    signalsByCustomer.set(row.customerId, list);
  }

  const values = customers.map((customer) => {
    const signals = (signalsByCustomer.get(customer.id) ?? []).map((row) => {
      const axis = axisByKey.get(row.axisKey)!;
      return {
        axisKey: row.axisKey,
        axisLabel: axis.label,
        value: row.value,
        inverted: axis.inverted,
      };
    });

    const history = historyByCustomer.get(customer.id) ?? [];
    const now = Date.now();
    const daysSince = (d: Date) => (now - d.getTime()) / 864e5;
    const mostRecent = history.reduce<Date | null>(
      (acc, h) => (!acc || h.startedAt > acc ? h.startedAt : acc),
      null,
    );

    const facts: RuleFacts = {
      tier: customer.tier,
      segment: customer.segment,
      ltvPence: customer.ltvPence,
      // A customer never contacted is maximally quiet, not unknown.
      daysSinceContact: mostRecent ? Math.floor(daysSince(mostRecent)) : 9999,
      contacts30d: history.filter((h) => daysSince(h.startedAt) <= 30).length,
      serviceFailures90d: history.filter(
        (h) => daysSince(h.startedAt) <= 90 && h.outcome === "escalated",
      ).length,
      renewalDays: customer.renewsAt
        ? Math.round((customer.renewsAt.getTime() - now) / 864e5)
        : null,
      intent: history.find((h) => daysSince(h.startedAt) <= 1)?.intent ?? null,
    };

    const score = computeScore(signals, weights, ruleRows, facts);
    return {
      customerId: customer.id,
      modelScore: score.modelScore,
      overrideDelta: score.overrideDelta,
      blended: score.blended,
      breakdown: { contributions: score.contributions, rules: score.rules },
    };
  });

  await db.insert(s.customerScores).values(values);
  return values.length;
}

/** The latest score for each of a set of customers. */
export async function latestScores(customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, typeof s.customerScores.$inferSelect>();

  const rows = await db
    .select()
    .from(s.customerScores)
    .where(inArray(s.customerScores.customerId, customerIds))
    .orderBy(desc(s.customerScores.computedAt));

  const latest = new Map<string, typeof s.customerScores.$inferSelect>();
  for (const row of rows) {
    if (!latest.has(row.customerId)) latest.set(row.customerId, row);
  }
  return latest;
}
