import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { config } from "@/lib/config";
import { latestScores } from "./scoring";

/**
 * Read models for the customer screens.
 *
 * These return presentation-ready rows — bar widths and accent colours — so a
 * screen stays a layout and the thresholds live in one place. The colour rules
 * are the ones the designs specified.
 */

const ACCENT = "var(--color-accent)";
const ACCENT_200 = "var(--color-accent-200)";
const ACCENT_700 = "var(--color-accent-700)";
const ACCENT_800 = "var(--color-accent-800)";
const N_200 = "var(--color-neutral-200)";
const N_500 = "var(--color-neutral-500)";
const N_700 = "var(--color-neutral-700)";
const N_800 = "var(--color-neutral-800)";

const scoreColor = (n: number) => (n >= config.accentPriorityThreshold ? ACCENT : N_700);
const pct = (n: number) => `${Math.round(n)}%`;

const money = (pence: number) =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

/** How long ago, in the console's phrasing. */
function ago(date: Date | null): string {
  if (!date) return "never";
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export type CustomerRow = Awaited<ReturnType<typeof listCustomers>>[number];

export async function listCustomers(brandId: string, limit = 12) {
  const rows = await db
    .select()
    .from(s.customers)
    .where(eq(s.customers.brandId, brandId))
    .limit(200);

  const scores = await latestScores(rows.map((r) => r.id));
  const signals = await db
    .select()
    .from(s.customerSignals)
    .where(inArray(s.customerSignals.customerId, rows.map((r) => r.id)));

  const byCustomer = new Map<string, Map<string, (typeof signals)[number]>>();
  for (const sig of signals) {
    const map = byCustomer.get(sig.customerId) ?? new Map();
    map.set(sig.axisKey, sig);
    byCustomer.set(sig.customerId, map);
  }

  // Live conversations decide the "On call" flag, so the table reflects now.
  const live = await db
    .select({ customerId: s.conversations.customerId })
    .from(s.conversations)
    .where(and(eq(s.conversations.brandId, brandId), eq(s.conversations.status, "live")));
  const onCall = new Set(live.map((l) => l.customerId).filter(Boolean) as string[]);

  const enriched = rows.map((c) => {
    const sig = byCustomer.get(c.id);
    const churn = sig?.get("churn_risk")?.value ?? 0;
    const sentiment = sig?.get("sentiment");
    const priority = scores.get(c.id)?.blended ?? 0;
    const sentimentDisplay = sentiment?.display ?? "—";
    const negative = sentimentDisplay.startsWith("−") || sentimentDisplay.startsWith("-");

    const flag = onCall.has(c.id)
      ? "On call"
      : churn >= 60
        ? "Churn risk"
        : (sig?.get("expansion_potential")?.value ?? 0) >= 70
          ? "Expansion"
          : (sig?.get("advocacy_nps")?.value ?? 100) <= 30
            ? "Detractor"
            : (sig?.get("payment_reliability")?.value ?? 100) <= 40
              ? "Payment"
              : "Healthy";

    const hot = ["On call", "Churn risk", "Detractor", "Payment"].includes(flag);

    return {
      id: c.id,
      name: c.name,
      meta: [c.segment, c.tier, c.location].filter(Boolean).join(" · "),
      priority: Math.round(priority),
      pColor: scoreColor(priority),
      ltv: money(c.ltvPence),
      churn: `${Math.round(churn)} · ${churn >= 60 ? "high" : churn >= 35 ? "medium" : "low"}`,
      churnBar: pct(churn),
      churnColor: churn >= 60 ? ACCENT : N_500,
      sentiment: sentimentDisplay,
      sentColor: negative ? ACCENT_700 : N_800,
      last: onCall.has(c.id) ? "on call now" : ago(c.customerSince),
      owner: c.owner ?? "Unassigned",
      flag,
      flagBg: hot ? ACCENT_200 : N_200,
      flagFg: hot ? ACCENT_800 : N_800,
    };
  });

  enriched.sort((a, b) => b.priority - a.priority);
  return enriched.slice(0, limit);
}

/** The priority queue on the command center — the top of the same list. */
export async function priorityQueue(brandId: string, limit = 6) {
  const customers = await listCustomers(brandId, limit);
  const scores = await latestScores(customers.map((c) => c.id));

  return customers.map((c) => {
    const breakdown = scores.get(c.id)?.breakdown as
      | { contributions?: { axisLabel: string; contribution: number }[]; rules?: { name: string }[] }
      | undefined;

    // "Why it's high" is the top contributing axis plus any rule that fired —
    // the same arithmetic the profile shows, compressed to a line.
    const top = (breakdown?.contributions ?? []).slice(0, 2).map((x) => x.axisLabel.toLowerCase());
    const rule = breakdown?.rules?.[0]?.name;
    const why = [top.join(" · "), rule && `rule "${rule}"`].filter(Boolean).join(" · ") || "—";

    return {
      ...c,
      why,
      value: c.ltv,
      pBar: pct(c.priority),
      action: c.flag === "On call" ? "Call now" : c.flag === "Payment" ? "Payment nudge" : c.flag,
      actionBg: c.flagBg,
      actionFg: c.flagFg,
    };
  });
}

/** One customer's full record, for Customer 360. */
export async function getCustomer(brandId: string, customerId: string) {
  const [customer] = await db
    .select()
    .from(s.customers)
    .where(and(eq(s.customers.brandId, brandId), eq(s.customers.id, customerId)))
    .limit(1);
  if (!customer) return null;

  const [scoreRow] = await db
    .select()
    .from(s.customerScores)
    .where(eq(s.customerScores.customerId, customerId))
    .orderBy(desc(s.customerScores.computedAt))
    .limit(1);

  const signals = await db
    .select({ signal: s.customerSignals, axis: s.scoringAxes })
    .from(s.customerSignals)
    .innerJoin(s.scoringAxes, eq(s.scoringAxes.key, s.customerSignals.axisKey))
    .where(eq(s.customerSignals.customerId, customerId));

  const conversations = await db
    .select()
    .from(s.conversations)
    .where(eq(s.conversations.customerId, customerId))
    .orderBy(desc(s.conversations.startedAt))
    .limit(20);

  return { customer, score: scoreRow ?? null, signals, conversations };
}
