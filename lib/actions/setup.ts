"use server";

import { and, eq } from "drizzle-orm";
import { WEBHOOK_EVENTS, newWebhookSecret, ping, webhookUrl } from "@/lib/integrations/webhooks";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { audit } from "./audit";
import { formatPhone, isPlausiblePhone, numberTaken } from "@/lib/business/phone";
import { createApiKey } from "@/lib/integrations/keys";
import { accountState } from "@/lib/billing/usage";

/**
 * Workspace setup.
 *
 * Brands, channels, opening hours, privacy and integrations. Three of these
 * change what the agent does on a live call — hours decide whether it answers
 * at all, channel state decides whether it sends or only drafts, and privacy
 * decides whether it may record — so they are ordinary rows with ordinary
 * checks rather than a settings blob nobody can audit.
 */

const CHANNEL_KINDS = ["phone", "whatsapp", "web_chat", "email", "sms", "survey"] as const;

/** Create a brand. New brands start dark: no agent, nothing live. */
export async function createBrand(input: { name: string; segment: string; location: string }) {
  const { session } = await getConsoleContext();
  assertCan(session.actor, "billing.manage");

  const name = input.name.trim();
  if (!name) throw new Error("A brand needs a name.");

  const account = await accountState(session.orgId);
  if (account.counts.brands >= account.plan.brands) {
    throw new Error(
      `The ${account.plan.name} plan covers ${account.plan.brands === 1 ? "one brand" : `${account.plan.brands} brands`}. Move up a plan in Billing to add another.`,
    );
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const [existing] = await db
    .select()
    .from(s.brands)
    .where(and(eq(s.brands.orgId, session.orgId), eq(s.brands.slug, slug)))
    .limit(1);
  if (existing) throw new Error(`${name} already exists in this workspace.`);

  const initials =
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "??";

  const [brand] = await db
    .insert(s.brands)
    .values({
      orgId: session.orgId,
      slug,
      name,
      initials,
      segment: input.segment.trim() || null,
      location: input.location.trim() || null,
      isLive: false,
    })
    .returning();

  // Default hours, so the brand has an answer to "are you open" from minute one.
  await db.insert(s.businessHours).values(
    Array.from({ length: 7 }, (_, weekday) => ({
      brandId: brand.id,
      weekday,
      opensMinute: weekday === 5 ? 600 : 540,
      closesMinute: weekday === 5 ? 960 : 1080,
      closed: weekday === 6,
    })),
  );

  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "brand.created",
    target: name,
  });

  revalidatePath("/app/setup");
  revalidatePath("/app", "layout");
  return brand.id;
}

/**
 * Take a brand live, or take it down.
 *
 * A brand with no published document and no agent version cannot go live: it
 * would answer the phone with nothing behind it, which is precisely the
 * failure the product exists to prevent.
 */
export async function setBrandLive(brandId: string, live: boolean) {
  const { session } = await getConsoleContext();
  assertCan(session.actor, "billing.manage");

  const [brand] = await db
    .select()
    .from(s.brands)
    .where(and(eq(s.brands.id, brandId), eq(s.brands.orgId, session.orgId)))
    .limit(1);
  if (!brand) throw new Error("No such brand in this workspace.");

  if (live) {
    const [version] = await db
      .select()
      .from(s.agentVersions)
      .where(and(eq(s.agentVersions.brandId, brandId), eq(s.agentVersions.status, "live")))
      .limit(1);
    if (!version) throw new Error("Publish an agent version before taking this brand live.");

    const [doc] = await db
      .select()
      .from(s.documents)
      .where(and(eq(s.documents.brandId, brandId), eq(s.documents.status, "published")))
      .limit(1);
    if (!doc) throw new Error("Publish at least one document — the agent has nothing to answer from.");
  }

  await db.update(s.brands).set({ isLive: live }).where(eq(s.brands.id, brandId));

  await audit({
    orgId: session.orgId,
    brandId,
    actorId: session.membershipId,
    actorName: session.name,
    action: live ? "brand.went_live" : "brand.taken_down",
    target: brand.name,
  });

  revalidatePath("/app/setup");
  revalidatePath("/app", "layout");
}

/** Connect a channel, change what it answers on, or take it off. */
export async function setChannel(input: {
  brandId: string;
  kind: (typeof CHANNEL_KINDS)[number];
  address: string;
  detail: string;
  state: "live" | "drafts_only" | "not_connected";
}) {
  const { session } = await getConsoleContext();
  assertCan(session.actor, "billing.manage");

  const [brand] = await db
    .select()
    .from(s.brands)
    .where(and(eq(s.brands.id, input.brandId), eq(s.brands.orgId, session.orgId)))
    .limit(1);
  if (!brand) throw new Error("No such brand in this workspace.");
  if (!CHANNEL_KINDS.includes(input.kind)) throw new Error("That is not a channel Corva answers.");
  if (input.state !== "not_connected" && !input.address.trim()) {
    throw new Error("A connected channel needs a number, address or origin to answer on.");
  }

  // The phone number is what routes a call to this business, so it has to be
  // a real number and nobody else's.
  let address = input.address.trim();
  let detail = input.detail.trim();
  if (input.kind === "phone" && address) {
    if (!isPlausiblePhone(address)) throw new Error("That phone number does not look right.");
    const clash = await numberTaken(address, brand.id);
    if (clash) throw new Error(`${formatPhone(address)} is already ${clash}'s number.`);
    address = formatPhone(address);
    if (!detail || isPlausiblePhone(detail)) detail = address;
  }
  input = { ...input, address, detail };

  await db
    .insert(s.channels)
    .values({
      brandId: input.brandId,
      kind: input.kind,
      address: input.address.trim() || null,
      detail: input.detail.trim() || null,
      state: input.state,
    })
    .onConflictDoUpdate({
      target: [s.channels.brandId, s.channels.kind],
      set: {
        address: input.address.trim() || null,
        detail: input.detail.trim() || null,
        state: input.state,
      },
    });

  await audit({
    orgId: session.orgId,
    brandId: input.brandId,
    actorId: session.membershipId,
    actorName: session.name,
    action: "channel.configured",
    target: input.kind,
    meta: { state: input.state },
  });

  revalidatePath("/app/setup");
}

/** Set one weekday's opening hours. */
export async function setBusinessHours(
  brandId: string,
  weekday: number,
  input: { closed: boolean; opensMinute: number; closesMinute: number },
) {
  const { session } = await getConsoleContext();
  assertCan(session.actor, "billing.manage");

  const [brand] = await db
    .select()
    .from(s.brands)
    .where(and(eq(s.brands.id, brandId), eq(s.brands.orgId, session.orgId)))
    .limit(1);
  if (!brand) throw new Error("No such brand in this workspace.");
  if (weekday < 0 || weekday > 6) throw new Error("There are seven days in a week.");
  if (!input.closed && input.closesMinute <= input.opensMinute) {
    throw new Error("Closing time has to be after opening time.");
  }

  await db
    .insert(s.businessHours)
    .values({ brandId, weekday, ...input })
    .onConflictDoUpdate({
      target: [s.businessHours.brandId, s.businessHours.weekday],
      set: input,
    });

  revalidatePath("/app/setup");
}

/**
 * The tenant's privacy position.
 *
 * `allowSupportAccess` is the one that reaches outside this workspace: turning
 * it off means Corva's own staff cannot request a grant at all, which is why
 * it is on this screen rather than buried under an admin flag.
 */
export async function setPrivacy(input: {
  retentionDays: number;
  redactPii: boolean;
  trainOnTranscripts: boolean;
  recordCalls: boolean;
  allowSupportAccess: boolean;
  dpoEmail: string;
}) {
  const { session } = await getConsoleContext();
  assertCan(session.actor, "billing.manage");

  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 30 || input.retentionDays > 3650) {
    throw new Error("Retention runs from 30 days to ten years.");
  }

  const [org] = await db
    .select()
    .from(s.organizations)
    .where(eq(s.organizations.id, session.orgId))
    .limit(1);

  await db
    .insert(s.privacySettings)
    .values({
      orgId: session.orgId,
      retentionDays: input.retentionDays,
      redactPii: input.redactPii,
      trainOnTranscripts: input.trainOnTranscripts,
      recordCalls: input.recordCalls,
      allowSupportAccess: input.allowSupportAccess,
      dpoEmail: input.dpoEmail.trim() || null,
      // Residency follows the organization; it is not separately editable,
      // because moving data between regions is a migration, not a toggle.
      dataRegion: org?.region ?? "eu-west-2",
      updatedByName: session.name,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: s.privacySettings.orgId,
      set: {
        retentionDays: input.retentionDays,
        redactPii: input.redactPii,
        trainOnTranscripts: input.trainOnTranscripts,
        recordCalls: input.recordCalls,
        allowSupportAccess: input.allowSupportAccess,
        dpoEmail: input.dpoEmail.trim() || null,
        updatedByName: session.name,
        updatedAt: new Date(),
      },
    });

  await audit({
    orgId: session.orgId,
    actorId: session.membershipId,
    actorName: session.name,
    action: "privacy.updated",
    target: session.orgSlug,
    meta: { ...input },
  });

  revalidatePath("/app/setup");
}

/* ─── API keys ─────────────────────────────────────────────────────────── */

/**
 * Make a key for this business's own systems — its website, its booking form.
 *
 * The key is returned once, here, and never again: only its hash is kept.
 * Owners and Admins only, since a key can create customers and leads.
 */
export async function createKey(name: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const { key, row } = await createApiKey(brand.id, name, session.name);
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "api_key.created",
    target: `${row.name} (${row.prefix}…)`,
  });
  revalidatePath("/app/setup");
  return { key, prefix: row.prefix };
}

export async function revokeKey(keyId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const [row] = await db
    .update(s.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(s.apiKeys.id, keyId), eq(s.apiKeys.brandId, brand.id)))
    .returning();
  if (!row) throw new Error("No such key for this business.");
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "api_key.revoked",
    target: `${row.name} (${row.prefix}…)`,
  });
  revalidatePath("/app/setup");
}

/* ─── Webhooks ─────────────────────────────────────────────────────────── */

/** Register a URL for Corva to tell about leads, follow-ups, handoffs and ended conversations. */
export async function createWebhook(url: string, events: string[]) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });

  const target = webhookUrl(url);
  const known = new Set<string>(WEBHOOK_EVENTS.map((e) => e.type));
  const chosen = [...new Set(events.filter((e) => known.has(e)))];
  const existing = await db.select({ id: s.webhooks.id }).from(s.webhooks).where(eq(s.webhooks.brandId, brand.id));
  if (existing.length >= 5) throw new Error("Five webhooks at most. Remove one first.");

  const secret = newWebhookSecret();
  const [row] = await db
    .insert(s.webhooks)
    // All events is stored as none chosen, so a new event type reaches it too.
    .values({ brandId: brand.id, url: target, secret, events: chosen.length === known.size ? [] : chosen, createdByName: session.name })
    .returning();
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "webhook.created",
    target,
  });
  revalidatePath("/app/setup");
  return { id: row.id, secret };
}

export async function deleteWebhook(webhookId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const [row] = await db
    .delete(s.webhooks)
    .where(and(eq(s.webhooks.id, webhookId), eq(s.webhooks.brandId, brand.id)))
    .returning();
  if (!row) throw new Error("No such webhook for this business.");
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: "webhook.removed",
    target: row.url,
  });
  revalidatePath("/app/setup");
}

/** Send a `ping` now and say what came back. */
export async function testWebhook(webhookId: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const result = await ping(webhookId, brand.id);
  revalidatePath("/app/setup");
  return result;
}
