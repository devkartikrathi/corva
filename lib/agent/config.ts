import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { intakeFieldsFor, type IntakeField } from "@/lib/business/intake";

/**
 * The published configuration a brand's agent runs under.
 *
 * Loaded per conversation and pinned to it, so a version published mid-call
 * cannot change the rules underneath a customer, and a transcript can always
 * be replayed against the exact configuration that produced it.
 */

export type AuthorityLimit = {
  action: string;
  label: string;
  ceilingPaise: number | null;
  blocked: boolean;
  escalateTo: string | null;
};

export type Trigger = {
  id: string;
  description: string;
  rule: Record<string, unknown>;
};

export type AgentConfig = {
  versionId: string;
  version: number;
  brandId: string;
  brandName: string;
  agentName: string;
  /**
   * The model this brand's agent answers on, resolved from the brand row.
   *
   * Part of the config rather than a global, so every path that already loads
   * a config — a live turn, a voice session, a brief, a test preview — gets
   * the brand's choice without a second lookup, and none of them can be the
   * one place that forgets.
   */
  modelId: string;
  /** Which industry template the business uses — its pipeline words and lead questions. */
  industry: string;
  persona: string;
  tone: Record<string, number>;
  authority: AuthorityLimit[];
  triggers: Trigger[];
  neverRules: string[];
  /**
   * What the business wants found out from every customer (Details to
   * collect). The business's current list, not the version's: it is a
   * business setting, not a behaviour to be drafted and published.
   */
  fields: IntakeField[];
};

/** The live version for a brand, or a specific one for replay. */
export async function loadAgentConfig(
  brandId: string,
  versionId?: string,
): Promise<AgentConfig | null> {
  const [row] = await db
    .select({ version: s.agentVersions, brand: s.brands })
    .from(s.agentVersions)
    .innerJoin(s.brands, eq(s.brands.id, s.agentVersions.brandId))
    .where(
      versionId
        ? eq(s.agentVersions.id, versionId)
        : and(eq(s.agentVersions.brandId, brandId), eq(s.agentVersions.status, "live")),
    )
    .limit(1);

  if (!row) return null;

  const [authority, triggers, never, fields] = await Promise.all([
    db.select().from(s.authorityLimits).where(eq(s.authorityLimits.agentVersionId, row.version.id)),
    db
      .select()
      .from(s.escalationTriggers)
      .where(
        and(
          eq(s.escalationTriggers.agentVersionId, row.version.id),
          eq(s.escalationTriggers.enabled, true),
        ),
      ),
    db.select().from(s.neverRules).where(eq(s.neverRules.agentVersionId, row.version.id)),
    intakeFieldsFor(row.brand.id, row.brand.industry),
  ]);

  return {
    versionId: row.version.id,
    version: row.version.version,
    brandId: row.brand.id,
    brandName: row.brand.name,
    agentName: row.brand.agentName ?? "the assistant",
    modelId: row.brand.modelId,
    industry: row.brand.industry,
    persona: row.version.persona,
    tone: (row.version.tone ?? {}) as Record<string, number>,
    authority: authority.map((a) => ({
      action: a.action,
      label: a.label,
      ceilingPaise: a.ceilingPaise,
      blocked: a.blocked,
      escalateTo: a.escalateTo,
    })),
    triggers: triggers.map((t) => ({
      id: t.id,
      description: t.description,
      rule: (t.rule ?? {}) as Record<string, unknown>,
    })),
    neverRules: never.map((n) => n.description),
    fields,
  };
}
