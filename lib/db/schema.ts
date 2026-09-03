/**
 * The Corva data model.
 *
 * Three tenancy layers, because the product has three audiences:
 *   organization  — a company that buys Corva (Aurelius Group)
 *   brand         — a customer-facing identity inside it (Aurelius Home)
 *   customer      — an end customer of that brand (Marguerite Okonkwo)
 *
 * Corva's own staff live outside that tree entirely, in `staff`, and can only
 * read tenant content through a time-boxed `supportGrants` row.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/* ─── Enums ────────────────────────────────────────────────────────────── */

/** Roles a person can hold inside one organization. Ordered most → least. */
export const roleEnum = pgEnum("role", ["owner", "admin", "manager", "agent", "analyst"]);

export const planEnum = pgEnum("plan", ["trial", "studio", "operator", "enterprise"]);

export const channelEnum = pgEnum("channel", ["phone", "whatsapp", "web_chat", "email", "sms", "survey"]);

/** Who produced a turn. `human` covers the tenant's own agents. */
export const speakerEnum = pgEnum("speaker", ["customer", "ai", "human", "system"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "live",
  "waiting_human",
  "resolved",
  "abandoned",
]);

/** How a conversation ended, in the tenant's language. */
export const outcomeEnum = pgEnum("outcome", [
  "ai_resolved",
  "human_resolved",
  "escalated",
  "no_document",
  "no_follow_up",
  "detractor",
]);

export const handoffStatusEnum = pgEnum("handoff_status", ["waiting", "accepted", "resolved", "reassigned"]);

export const docStatusEnum = pgEnum("doc_status", ["draft", "published", "archived", "missing"]);

export const agentVersionStatusEnum = pgEnum("agent_version_status", ["draft", "live", "retired"]);

export const actorTypeEnum = pgEnum("actor_type", ["user", "staff", "ai", "system"]);

/* ─── Tenancy ──────────────────────────────────────────────────────────── */

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  plan: planEnum("plan").notNull().default("trial"),
  /** Where this tenant's data must live, e.g. "eu-west-2". */
  region: text("region").notNull().default("eu-west-2"),
  /** Denormalised for the operator fleet table; recomputed nightly. */
  healthScore: integer("health_score"),
  mrrPence: integer("mrr_pence").notNull().default(0),
  seatCount: integer("seat_count").notNull().default(0),
  renewsAt: timestamp("renews_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** Two-letter mark shown in the brand switcher. */
    initials: text("initials").notNull(),
    /** "Retail", "Trade", "Subscription" — free text, it varies by tenant. */
    segment: text("segment"),
    location: text("location"),
    /** The name the AI answers to on this brand's line. */
    agentName: text("agent_name"),
    isLive: boolean("is_live").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("brands_org_slug_idx").on(t.orgId, t.slug)],
);

/**
 * A person's role inside one organization. Identity comes from Clerk; the
 * role model is finer-grained than Clerk orgs (it is scoped per brand), so it
 * lives here and Clerk is used purely to answer "who is this".
 */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    /** Null means every brand in the org; otherwise see membershipBrands. */
    allBrands: boolean("all_brands").notNull().default(false),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.orgId, t.clerkUserId),
    index("memberships_user_idx").on(t.clerkUserId),
  ],
);

/** Brand scoping for a membership that is not `allBrands`. */
export const membershipBrands = pgTable(
  "membership_brands",
  {
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.brandId] })],
);

/* ─── Corva staff (the operator console) ───────────────────────────────── */

/**
 * Platform operators. Deliberately not a role in `memberships`: no tenant can
 * ever hold it, and it is not reachable by editing an organization.
 */
export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The only way a staff member reads tenant content. The design is emphatic
 * that this is requested, time-boxed, visible to the Owner and audited — so it
 * is a row with an expiry, not a UI convention.
 */
export const supportGrants = pgTable(
  "support_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => staff.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** The org member who approved it, if approval was required. */
    approvedByMembershipId: uuid("approved_by_membership_id").references(() => memberships.id),
  },
  (t) => [index("support_grants_org_idx").on(t.orgId, t.expiresAt)],
);

/* ─── Customers ────────────────────────────────────────────────────────── */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** The tenant's own identifier, e.g. "AH-CU-40912". */
    externalRef: text("external_ref"),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    location: text("location"),
    segment: text("segment"),
    tier: text("tier"),
    owner: text("owner"),
    customerSince: timestamp("customer_since", { withTimezone: true }),
    ltvPence: integer("ltv_pence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_brand_idx").on(t.brandId),
    index("customers_phone_idx").on(t.phone),
    uniqueIndex("customers_brand_ref_idx").on(t.brandId, t.externalRef),
  ],
);

/** One of the eleven scoring dimensions. Seeded, extendable per brand. */
export const scoringAxes = pgTable("scoring_axes", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  /** "model", "manual" or "rules" — where the value comes from. */
  source: text("source").notNull().default("model"),
  /**
   * Whether a high value *lowers* priority.
   *
   * Not the same as "is this good news". High lifetime value is good news but
   * raises priority — there is more at stake. High sentiment is good news and
   * lowers it. Only the second kind is inverted.
   */
  inverted: boolean("inverted").notNull().default(false),
});

/** Per-brand weighting of each axis. The model proposes; these tune. */
export const brandAxisWeights = pgTable(
  "brand_axis_weights",
  {
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    axisKey: text("axis_key")
      .notNull()
      .references(() => scoringAxes.key, { onDelete: "cascade" }),
    weight: real("weight").notNull(),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.axisKey] })],
);

/** A customer's current value on one axis. */
export const customerSignals = pgTable(
  "customer_signals",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    axisKey: text("axis_key")
      .notNull()
      .references(() => scoringAxes.key, { onDelete: "cascade" }),
    /** Normalised 0–100 so axes are comparable. */
    value: real("value").notNull(),
    /** What to print, when the raw value reads better ("−0.32", "Premier"). */
    display: text("display"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.axisKey] })],
);

/**
 * A timestamped score. Never updated in place — the design promises you can
 * see a customer as they were three months ago.
 */
export const customerScores = pgTable(
  "customer_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    modelScore: real("model_score").notNull(),
    overrideDelta: real("override_delta").notNull().default(0),
    blended: real("blended").notNull(),
    /** Per-axis contributions and the rules that fired, for "why this number". */
    breakdown: jsonb("breakdown").notNull().default([]),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customer_scores_customer_idx").on(t.customerId, t.computedAt)],
);

/** An attributed override rule. Applied top to bottom after the model. */
export const priorityRules = pgTable(
  "priority_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A small AST: { all: [{ field, op, value }, …] }. */
    condition: jsonb("condition").notNull(),
    /** Points added to (or subtracted from) the model score. */
    effect: real("effect").notNull(),
    /** Side effects: alert a channel, assign an owner, force a human. */
    actions: jsonb("actions").notNull().default([]),
    authorName: text("author_name"),
    ordinal: integer("ordinal").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("priority_rules_brand_idx").on(t.brandId, t.ordinal)],
);

export const segments = pgTable(
  "segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    definition: jsonb("definition").notNull().default({}),
    ownerName: text("owner_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("segments_brand_idx").on(t.brandId)],
);

/* ─── Knowledge ────────────────────────────────────────────────────────── */

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    collection: text("collection").notNull().default("Uncategorised"),
    title: text("title").notNull(),
    /** "Policy", "Playbook", "Reference", "Product", "Guide". */
    kind: text("kind").notNull().default("Policy"),
    body: text("body").notNull().default(""),
    ownerName: text("owner_name"),
    status: docStatusEnum("status").notNull().default("published"),
    /** Denormalised usage stats, recomputed from citations. */
    citationCount: integer("citation_count").notNull().default(0),
    successRate: real("success_rate"),
    sourceSystem: text("source_system"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_brand_idx").on(t.brandId, t.status)],
);

/**
 * A retrievable slice of a document. The AI may only answer from these, and
 * every answer records which ones it used.
 */
export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    /** A human-facing anchor, e.g. "§3.2". */
    anchor: text("anchor"),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
  },
  (t) => [
    index("document_chunks_doc_idx").on(t.documentId, t.ordinal),
    // Retrieval is always scoped to one brand before it is scoped by distance.
    index("document_chunks_brand_idx").on(t.brandId),
  ],
);

/** An intent the AI could not answer, counted so it can be fixed. */
export const knowledgeGaps = pgTable(
  "knowledge_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    intent: text("intent").notNull(),
    hits: integer("hits").notNull().default(1),
    /** "no_document", "contradiction", "authority_ceiling", "blocked_action". */
    reason: text("reason").notNull().default("no_document"),
    draftDocumentId: uuid("draft_document_id").references(() => documents.id, { onDelete: "set null" }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("knowledge_gaps_brand_intent_idx").on(t.brandId, t.intent)],
);

/* ─── Agent configuration ──────────────────────────────────────────────── */

/** An immutable, publishable configuration of a brand's agent. */
export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    persona: text("persona").notNull(),
    /** { warmth, brevity, formality, persistence } — each 0–10. */
    tone: jsonb("tone").notNull().default({}),
    status: agentVersionStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    authorName: text("author_name"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_versions_brand_version_idx").on(t.brandId, t.version)],
);

/** What the AI may do without asking, and what happens above the ceiling. */
export const authorityLimits = pgTable(
  "authority_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentVersionId: uuid("agent_version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "cascade" }),
    /** Machine key the agent checks, e.g. "goodwill_credit". */
    action: text("action").notNull(),
    label: text("label").notNull(),
    /** Null with `blocked` false means unlimited. */
    ceilingPence: integer("ceiling_pence"),
    blocked: boolean("blocked").notNull().default(false),
    /** Who can approve above the ceiling: "manager", "owner", "human", null. */
    escalateTo: text("escalate_to"),
  },
  (t) => [uniqueIndex("authority_limits_version_action_idx").on(t.agentVersionId, t.action)],
);

export const escalationTriggers = pgTable("escalation_triggers", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentVersionId: uuid("agent_version_id")
    .notNull()
    .references(() => agentVersions.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  /** A checkable rule: { kind: "phrase" | "sentiment" | "score" | …, … }. */
  rule: jsonb("rule").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
});

export const neverRules = pgTable("never_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentVersionId: uuid("agent_version_id")
    .notNull()
    .references(() => agentVersions.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
});

/* ─── Conversations ────────────────────────────────────────────────────── */

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    channel: channelEnum("channel").notNull(),
    intent: text("intent"),
    status: conversationStatusEnum("status").notNull().default("live"),
    outcome: outcomeEnum("outcome"),
    /** Which agent configuration handled it, for replay and attribution. */
    agentVersionId: uuid("agent_version_id").references(() => agentVersions.id, { onDelete: "set null" }),
    handledBy: text("handled_by"),
    sentimentStart: real("sentiment_start"),
    sentimentEnd: real("sentiment_end"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    /** True when no human was needed — the containment metric. */
    contained: boolean("contained"),
    reviewScore: integer("review_score"),
    reviewerName: text("reviewer_name"),
  },
  (t) => [
    index("conversations_brand_started_idx").on(t.brandId, t.startedAt),
    index("conversations_customer_idx").on(t.customerId, t.startedAt),
    index("conversations_status_idx").on(t.brandId, t.status),
  ],
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    speaker: speakerEnum("speaker").notNull(),
    /** Name of the human, when the speaker is one. */
    authorName: text("author_name"),
    body: text("body").notNull(),
    sentiment: real("sentiment"),
    /** Offset from the start of the call, for "04:12" labels. */
    atSeconds: integer("at_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("turns_conversation_ordinal_idx").on(t.conversationId, t.ordinal)],
);

/**
 * What an AI turn leaned on. A turn with no citation is exactly the failure
 * the quality screens count, so this is recorded even when retrieval failed.
 */
export const turnCitations = pgTable(
  "turn_citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    chunkId: uuid("chunk_id").references(() => documentChunks.id, { onDelete: "set null" }),
    /** Cosine similarity at retrieval time, 0–1. */
    confidence: real("confidence"),
    /** The policy check the answer passed, e.g. "Goodwill ceiling £50". */
    checkLabel: text("check_label"),
    quote: text("quote"),
  },
  (t) => [index("turn_citations_turn_idx").on(t.turnId)],
);

/** An action the AI took mid-conversation, within its authority. */
export const conversationActions = pgTable(
  "conversation_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    label: text("label").notNull(),
    amountPence: integer("amount_pence"),
    atSeconds: integer("at_seconds"),
    /** False when it was refused for exceeding a ceiling. */
    allowed: boolean("allowed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_actions_conversation_idx").on(t.conversationId)],
);

/** The queue a human picks up, with the brief the AI wrote. */
export const handoffs = pgTable(
  "handoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    /** { wants, alreadyDid[], decision, openingLine, sensitivities }. */
    brief: jsonb("brief").notNull().default({}),
    status: handoffStatusEnum("status").notNull().default("waiting"),
    waitingSince: timestamp("waiting_since", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByMembershipId: uuid("accepted_by_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    resolution: text("resolution"),
  },
  (t) => [index("handoffs_brand_status_idx").on(t.brandId, t.status, t.waitingSince)],
);

/* ─── Audit ────────────────────────────────────────────────────────────── */

/**
 * Every consequential action, by anyone. Tenant-visible: a staff member's
 * reads land here too, which is what makes the support-access promise real.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    actorType: actorTypeEnum("actor_type").notNull(),
    /** Clerk user id, staff id, or the agent version that acted. */
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_org_at_idx").on(t.orgId, t.at)],
);

/* ─── Platform operations (the operator console) ───────────────────────── */

export const regions = pgTable("regions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  voiceP95Ms: integer("voice_p95_ms"),
  uptime30d: numeric("uptime_30d", { precision: 5, scale: 2 }),
  state: text("state").notNull().default("healthy"),
});

export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  severity: text("severity").notNull(),
  regionKey: text("region_key").references(() => regions.key, { onDelete: "set null" }),
  note: text("note").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  affectedOrgCount: integer("affected_org_count").notNull().default(0),
});

/** A platform capability rolled out per tenant. */
export const featureFlags = pgTable(
  "feature_flags",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(),
    note: text("note"),
    /** Default for tenants with no explicit override. */
    defaultOn: boolean("default_on").notNull().default(false),
  },
);

export const orgFeatureFlags = pgTable(
  "org_feature_flags",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => featureFlags.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.flagKey] })],
);

/** A cross-tenant failure the platform team owns, not the tenant. */
export const qualityFlags = pgTable(
  "quality_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "set null" }),
    /** "unsupported_claim", "no_citation", "invented_date", … */
    failureClass: text("failure_class").notNull(),
    rootCause: text("root_cause"),
    owner: text("owner").notNull().default("tenant"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quality_flags_org_idx").on(t.orgId, t.createdAt)],
);

/* ─── Channels & integrations ──────────────────────────────────────────── */

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    kind: channelEnum("kind").notNull(),
    /** The phone number, address or origin the channel answers on. */
    address: text("address"),
    detail: text("detail"),
    /** "live", "drafts_only", "not_connected". */
    state: text("state").notNull().default("not_connected"),
  },
  (t) => [uniqueIndex("channels_brand_kind_idx").on(t.brandId, t.kind)],
);

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose"),
    status: text("status").notNull().default("connected"),
    healthy: boolean("healthy").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  },
  (t) => [unique("integrations_org_name_key").on(t.orgId, t.name)],
);
