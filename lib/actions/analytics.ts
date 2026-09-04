"use server";

import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { intOf, type Params } from "@/lib/params";
import {
  getBrandMetrics,
  qualityMetrics,
  unfinishedIntents,
  weeklyContainment,
} from "@/lib/queries/analytics";
import { audit } from "./audit";

/**
 * The analytics screen as a CSV.
 *
 * Three blocks in one file — headline metrics, weekly containment, and the
 * intents the AI still cannot finish — because that is what the screen shows
 * and someone exporting it wants the argument, not one table out of three.
 * Gated on `transcripts.export`: it is aggregate, but it is still this
 * tenant's operating data leaving the workspace, and it is audited as such.
 */
export async function exportAnalyticsCsv(query: Params): Promise<string> {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "transcripts.export", { brandId: brand.id });

  const weeksBack = intOf(query, "weeks", 12, 1, 52);
  const from = new Date(Date.now() - weeksBack * 7 * 864e5);

  const [m, containment, intents, quality] = await Promise.all([
    getBrandMetrics(brand.id, { from }),
    weeklyContainment(brand.id, weeksBack),
    unfinishedIntents(brand.id),
    qualityMetrics(brand.id),
  ]);

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "analytics.exported",
    target: brand.id,
    meta: { weeks: weeksBack },
  });

  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const row = (cells: (string | number)[]) => cells.map((c) => escape(String(c))).join(",");

  return [
    `# Corva analytics · ${brand.name} · last ${weeksBack} weeks · generated ${new Date().toISOString()}`,
    "",
    "Metric,Value",
    row(["Conversations", m.total]),
    row(["Contained by the AI", m.contained]),
    row(["Needed a person", m.escalated]),
    row(["Containment %", m.containment.toFixed(1)]),
    row(["Average handle seconds", m.avgHandleSeconds]),
    row(["Average sentiment at close", m.avgSentiment.toFixed(2)]),
    row(["Average review score", m.avgReview?.toFixed(2) ?? ""]),
    row(["Cost per contact (pence)", m.costPerContactPence]),
    ...quality.map((q) => row([q.label, q.value])),
    "",
    "Week,Contained,Escalated",
    ...containment.weeks.map((w, i) => row([`W${i + 1}`, w.contained, w.escalated])),
    "",
    "Unfinished intent,Contacts,Why,Estimated monthly cost,Fix",
    ...intents.map((i) => row([i.name, i.calls, i.reason, i.cost, i.fix])),
    "",
    "Channel,Share",
    ...m.channelMix.map((c) => row([c.name, c.share])),
  ].join("\n");
}
