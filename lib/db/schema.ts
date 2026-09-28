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

/** Whether a membership is a real person yet. `invited` has no Clerk id. */
export const membershipStatusEnum = pgEnum("membership_status", ["invited", "active", "suspended"]);

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

/**
 * Why a human was pulled in.
 *
 * `escalation` is the AI hitting a limit. `closure_approval` is the opposite
 * and is the reason this column exists: the customer was told no, accepted it,
 * and the conversation ended by agreement. Nothing is owed, but a person still
 * has to see that it happened and sign it off — otherwise "the AI talked them
 * out of a refund" is a decision nobody ever reviews.
 */
export const handoffKindEnum = pgEnum("handoff_kind", ["escalation", "closure_approval"]);

/**
 * Whether a person can take a call right now.
 *
 * Set by the person, not inferred from activity: someone at their desk writing
 * a report is not available, and someone who has not clicked in ten minutes
 * may well be on a call.
 */
export const availabilityEnum = pgEnum("availability", ["available", "busy", "offline"]);

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
  mrrPaise: integer("mrr_paise").notNull().default(0),
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
    /**
     * Which template this business was set up from — "clinic", "real_estate",
     * … — and so which words its pipeline uses. See lib/business/industries.ts.
     */
    industry: text("industry").notNull().default("general"),
    location: text("location"),
    /** The name the AI answers to on this brand's line. */
    agentName: text("agent_name"),
    /**
     * Which model answers for this brand.
     *
     * An operational choice as much as a quality one — the free tier meters
     * requests per day per model, so a brand in demo can sit on the roomy
     * model and move up when it starts carrying traffic. Chosen at onboarding,
     * changed from the account screen, and always one of `lib/agent/models.ts`
     * (an id that has since been retired resolves back to the default rather
     * than failing a call).
     */
    modelId: text("model_id").notNull().default("gemini-3.5-flash"),
    /** IANA zone the business hours below are expressed in. */
    timezone: text("timezone").notNull().default("Europe/London"),
    /** What happens outside business hours: "ai", "voicemail", "closed". */
    afterHoursMode: text("after_hours_mode").notNull().default("ai"),
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
    /** Null until the invite is accepted — a pending invite is a membership. */
    clerkUserId: text("clerk_user_id"),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    /** The single-use token in an invite link. Cleared on acceptance. */
    inviteToken: text("invite_token"),
    invitedByName: text("invited_by_name"),
    /** Null means every brand in the org; otherwise see membershipBrands. */
    allBrands: boolean("all_brands").notNull().default(false),
    /**
     * Whether this person can be handed a call right now.
     *
     * Routing reads it before it reads anything else — a five-star agent who
     * is offline is not a candidate, however good they are.
     */
    availability: availabilityEnum("availability").notNull().default("offline"),
    /**
     * How well they handle a handed-over call, 0–5.
     *
     * Seeded from their review history and recomputed from it; held on the row
     * because routing sorts on it on every escalation and a subquery over the
     * whole conversation table to pick one agent is not a trade worth making.
     */
    rating: real("rating"),
    /** Intents they are the right person for, e.g. ["refunds", "trade"]. */
    specialities: text("specialities").array().notNull().default([]),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_idx").on(t.orgId, t.clerkUserId),
    uniqueIndex("memberships_org_email_idx").on(t.orgId, t.email),
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
    /**
     * The person who holds this account.
     *
     * Null is not "unassigned by accident" — it is the AI handling the customer
     * on its own, which is a real and common state in this product. It is also
     * what the console scopes an Agent's screens by: an Agent sees the
     * customers that are theirs, a Manager sees everyone's and who has them.
     */
    ownerMembershipId: uuid("owner_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    /** The owner's name, denormalised for lists and CSV exports. */
    owner: text("owner"),
    customerSince: timestamp("customer_since", { withTimezone: true }),
    /** When their contract next renews. Feeds the "renewal window" rules. */
    renewsAt: timestamp("renews_at", { withTimezone: true }),
    ltvPaise: integer("ltv_paise").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("customers_brand_idx").on(t.brandId),
    index("customers_owner_idx").on(t.ownerMembershipId),
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
    updatedByName: text("updated_by_name"),
    /** Bumped on every published edit; matches the top documentRevisions row. */
    revision: integer("revision").notNull().default(1),
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
    ceilingPaise: integer("ceiling_paise"),
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
    /**
     * Which model actually answered, recorded when the first turn is served.
     *
     * Pinned here rather than read back off the brand, for the same reason
     * `agentVersionId` is: the brand's choice can change tomorrow, and this
     * conversation's cost was priced at the rates of the model that really ran
     * it. It is also the column that makes "did the cheap model hold up?" a
     * question the archive can answer instead of a hunch.
     *
     * Null on rows written before the choice existed, and on any conversation
     * that never reached the model.
     */
    modelId: text("model_id"),
    handledBy: text("handled_by"),
    sentimentStart: real("sentiment_start"),
    sentimentEnd: real("sentiment_end"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    /** True when no human was needed — the containment metric. */
    contained: boolean("contained"),
    /**
     * A rehearsal rather than a customer.
     *
     * Test calls are written to these tables like any other conversation —
     * that is what makes the playground worth having — but they must not reach
     * containment, cost, health or a customer's priority score, because those
     * are numbers people make decisions on. Kept as a column rather than a
     * separate table so a test call is visibly the same shape as a real one,
     * and so forgetting to exclude it is a bug someone can find.
     */
    isTest: boolean("is_test").notNull().default(false),
    /**
     * What this conversation cost to serve, in paise.
     *
     * Measured rather than estimated — real tokens, real audio seconds, real
     * human handling time — and accumulated as the conversation happens rather
     * than inferred from its duration afterwards. Denormalised onto the row
     * because every spending question starts by summing it.
     */
    costPaise: real("cost_paise").notNull().default(0),
    /**
     * The components behind that number, in the same shape `customerScores`
     * keeps its breakdown: a cost nobody can open up is one people stop
     * believing the first time it surprises them.
     */
    costBreakdown: jsonb("cost_breakdown").notNull().default({}),
    /**
     * One sentence a colleague could read instead of the transcript. Written
     * by the classification job when a conversation closes, not by a person.
     */
    summary: text("summary"),
    /**
     * The same thing, but for a call that is still happening.
     *
     * `summary` is written once, at the end, and is the archive's. This one is
     * rewritten as the conversation moves, and exists because of the moment
     * this product is actually built around: a colleague is being handed a
     * live customer and has seconds, not minutes, to know what is going on.
     * Reading twenty turns of transcript is not that.
     */
    liveSummary: text("live_summary"),
    /** When `liveSummary` was last rewritten, so it is not redone every poll. */
    liveSummaryAt: timestamp("live_summary_at", { withTimezone: true }),
    reviewScore: integer("review_score"),
    reviewerName: text("reviewer_name"),
    reviewNote: text("review_note"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("conversations_brand_started_idx").on(t.brandId, t.startedAt),
    index("conversations_customer_idx").on(t.customerId, t.startedAt),
    index("conversations_status_idx").on(t.brandId, t.status),
    // Every metric filters on this, so it earns its own index.
    index("conversations_is_test_idx").on(t.brandId, t.isTest),
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
    /** The policy check the answer passed, e.g. "Goodwill ceiling ₹5,000". */
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
    amountPaise: integer("amount_paise"),
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
    kind: handoffKindEnum("kind").notNull().default("escalation"),
    reason: text("reason").notNull(),
    /** { wants, alreadyDid[], decision, openingLine, sensitivities }. */
    brief: jsonb("brief").notNull().default({}),
    /** One line, for the transfer alert. The brief is what you read after. */
    headline: text("headline"),
    status: handoffStatusEnum("status").notNull().default("waiting"),
    /**
     * Who it is ringing at.
     *
     * A queue nobody is named on is a queue everybody assumes someone else is
     * working. Routing picks one person and puts them here; until they accept
     * or decline, the handoff is waiting *at them* rather than waiting in
     * general, and that is what the alert on their screen is showing.
     */
    routedToMembershipId: uuid("routed_to_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    routedAt: timestamp("routed_at", { withTimezone: true }),
    /** Why routing chose them — shown in the alert, so it is never a mystery. */
    routingReason: text("routing_reason"),
    /**
     * Membership ids that have already passed on this one.
     *
     * Kept so re-routing does not offer it straight back to the person who
     * just declined it, which is the obvious failure of any round-robin that
     * only remembers the current holder.
     */
    declinedBy: jsonb("declined_by").notNull().default([]),
    waitingSince: timestamp("waiting_since", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByMembershipId: uuid("accepted_by_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    resolution: text("resolution"),
  },
  (t) => [
    index("handoffs_brand_status_idx").on(t.brandId, t.status, t.waitingSince),
    // The alert polls this on every open console, so it is the one index that
    // has to hold up under the console being left open all day.
    index("handoffs_routed_idx").on(t.routedToMembershipId, t.status),
  ],
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
    /** "internal", "alpha", "beta", "ga". */
    stage: text("stage").notNull().default("internal"),
    /** Share of the fleet the flag is on for, 0-100. */
    rolloutPercent: integer("rollout_percent").notNull().default(0),
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
    summary: text("summary"),
    rootCause: text("root_cause"),
    owner: text("owner").notNull().default("tenant"),
    /** "open", "triaged", "fixed", "wont_fix". */
    status: text("status").notNull().default("open"),
    assignedToStaffId: uuid("assigned_to_staff_id").references(() => staff.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
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
    /** Channel-specific settings: greeting, voice, fallback number, hours. */
    config: jsonb("config").notNull().default({}),
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

/* ─── Saved views ──────────────────────────────────────────────────────── */

/**
 * A named filter set on a list screen.
 *
 * The query is stored as the same object the URL carries, so opening a saved
 * view and hand-editing the address bar reach the same code path — there is no
 * second, privileged way to filter a table.
 */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Null for a view every member of the org can see. */
    membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "cascade" }),
    /** Which list it belongs to: "customers", "conversations", "fleet". */
    surface: text("surface").notNull(),
    name: text("name").notNull(),
    /** The searchParams object, e.g. { segment: "Trade", minScore: "70" }. */
    query: jsonb("query").notNull().default({}),
    /** Opened when the screen is visited with no query of its own. */
    isDefault: boolean("is_default").notNull().default(false),
    ordinal: integer("ordinal").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_views_scope_idx").on(t.orgId, t.surface, t.ordinal)],
);

/* ─── Customer record ──────────────────────────────────────────────────── */

/** A note a person left on a customer. Appears inline in the timeline. */
export const customerNotes = pgTable(
  "customer_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    authorMembershipId: uuid("author_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    authorName: text("author_name").notNull(),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("customer_notes_customer_idx").on(t.customerId, t.createdAt)],
);

/**
 * What this customer has and has not agreed to.
 *
 * Held per customer rather than per org because consent is the customer's, not
 * the tenant's — and because the agent checks it before it records a call or
 * mentions a marketing offer.
 */
export const customerConsents = pgTable(
  "customer_consents",
  {
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** "marketing", "call_recording", "ai_training", "data_sharing". */
    kind: text("kind").notNull(),
    granted: boolean("granted").notNull().default(false),
    /** How it was captured: "web form", "verbal, call 8 Mar", … */
    detail: text("detail"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.customerId, t.kind] })],
);

/**
 * A row pulled in from one of the tenant's other systems — an order, a
 * subscription, an invoice, a ticket. Corva does not own these; it mirrors
 * them so the agent and the console can reason about them in one place.
 */
export const customerRecords = pgTable(
  "customer_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    /** "order", "subscription", "invoice", "ticket", "delivery". */
    kind: text("kind").notNull(),
    /** The other system's identifier, e.g. "AH-88213". */
    ref: text("ref"),
    label: text("label").notNull(),
    status: text("status"),
    amountPaise: integer("amount_paise"),
    /** Which integration it came from, so a stale mirror is attributable. */
    sourceSystem: text("source_system"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    meta: jsonb("meta").notNull().default({}),
  },
  (t) => [index("customer_records_customer_idx").on(t.customerId, t.occurredAt)],
);

/* ─── Brand operations ─────────────────────────────────────────────────── */

/** One weekday's opening hours for a brand, in the brand's own timezone. */
export const businessHours = pgTable(
  "business_hours",
  {
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** 0 = Monday, 6 = Sunday. */
    weekday: integer("weekday").notNull(),
    /** Minutes from midnight, so comparisons are integer arithmetic. */
    opensMinute: integer("opens_minute").notNull().default(540),
    closesMinute: integer("closes_minute").notNull().default(1080),
    closed: boolean("closed").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.weekday] })],
);

/** A knowledge source that syncs into `documents` on a schedule. */
export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "notion", "zendesk", "drive", "sharepoint", "upload". */
    kind: text("kind").notNull(),
    /** "syncing", "synced", "error", "paused". */
    status: text("status").notNull().default("synced"),
    docCount: integer("doc_count").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("knowledge_sources_brand_idx").on(t.brandId)],
);

/**
 * A published version of a document's text.
 *
 * The agent cites a chunk, and a chunk belongs to whatever the document said
 * at the time. Keeping revisions means an old citation can still be read as it
 * was when the answer was given.
 */
export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    note: text("note"),
    authorName: text("author_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("document_revisions_doc_rev_idx").on(t.documentId, t.revision)],
);

/**
 * Something wrong with the scoring model itself, as opposed to one customer's
 * score. Raised by the rescore job, cleared by a person.
 */
export const modelAlerts = pgTable(
  "model_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** "drift", "stale_signal", "rule_conflict", "coverage". */
    kind: text("kind").notNull(),
    /** "info", "warn", "critical". */
    severity: text("severity").notNull().default("warn"),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    axisKey: text("axis_key").references(() => scoringAxes.key, { onDelete: "set null" }),
    /** "open", "acknowledged", "resolved". */
    status: text("status").notNull().default("open"),
    acknowledgedByName: text("acknowledged_by_name"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("model_alerts_brand_idx").on(t.brandId, t.status, t.createdAt)],
);

/* ─── Org settings ─────────────────────────────────────────────────────── */

/**
 * The promises a tenant makes to its own customers. One row per org, because
 * retention and redaction are legal positions, not per-brand preferences.
 */
export const privacySettings = pgTable("privacy_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  /** Transcripts are deleted after this many days. */
  retentionDays: integer("retention_days").notNull().default(365),
  /** Strip card numbers, addresses and the like before storage. */
  redactPii: boolean("redact_pii").notNull().default(true),
  /** Whether this tenant's transcripts may improve the shared model. */
  trainOnTranscripts: boolean("train_on_transcripts").notNull().default(false),
  recordCalls: boolean("record_calls").notNull().default(true),
  /** Where the rows physically live; must match `organizations.region`. */
  dataRegion: text("data_region").notNull().default("eu-west-2"),
  dpoEmail: text("dpo_email"),
  /** Whether Corva staff may request a support grant at all. */
  allowSupportAccess: boolean("allow_support_access").notNull().default(true),
  updatedByName: text("updated_by_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ─── Platform history and operations ──────────────────────────────────── */

/**
 * One tenant's activity for one day. Denormalised on write because every
 * operator chart reads it and none of them wants to scan `conversations`.
 */
export const usageDaily = pgTable(
  "usage_daily",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    day: timestamp("day", { withTimezone: true }).notNull(),
    conversations: integer("conversations").notNull().default(0),
    contained: integer("contained").notNull().default(0),
    handoffs: integer("handoffs").notNull().default(0),
    aiMinutes: integer("ai_minutes").notNull().default(0),
    humanMinutes: integer("human_minutes").notNull().default(0),
    /** What the traffic cost Corva to serve, for unit economics. */
    costPaise: integer("cost_paise").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.day] })],
);

/**
 * How much of each model's daily ration has been spent.
 *
 * Not scoped to a tenant, deliberately: the free tier meters the API key, so
 * every brand on the platform draws from the same twenty requests. A per-org
 * counter would have shown four tenants comfortably inside their allowance on
 * the morning the whole key stopped answering.
 *
 * The declared ceiling lives in `lib/agent/models.ts` and drifts; this is the
 * half we actually know. Together they are "18 of 20 used" — which is the
 * question someone about to run a test call is really asking.
 */
export const modelUsageDaily = pgTable(
  "model_usage_daily",
  {
    /**
     * "YYYY-MM-DD" in the provider's timezone, not ours.
     *
     * A quota resets on Google's clock, and counting by our midnight would
     * report a fresh allowance for hours after it actually renewed — or worse,
     * the other way round. Text rather than a date column because the value is
     * computed in one place (`lib/agent/quota.ts`) and must not be re-coerced
     * into some other zone on the way in or out.
     */
    day: text("day").notNull(),
    modelId: text("model_id").notNull(),
    /** What the quota is actually counted in. */
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.modelId] })],
);

/** A tenant's recurring revenue at the close of one month. */
export const mrrSnapshots = pgTable(
  "mrr_snapshots",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** The first of the month it describes. */
    month: timestamp("month", { withTimezone: true }).notNull(),
    mrrPaise: integer("mrr_paise").notNull().default(0),
    seatCount: integer("seat_count").notNull().default(0),
    plan: planEnum("plan").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.month] })],
);

/** A staff note about a tenant. Never visible to the tenant. */
export const accountNotes = pgTable(
  "account_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
    authorName: text("author_name").notNull(),
    /** "note", "risk", "expansion", "incident". */
    kind: text("kind").notNull().default("note"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_notes_org_idx").on(t.orgId, t.createdAt)],
);

/** An upstream service the platform depends on, and how it is behaving. */
export const platformDependencies = pgTable("platform_dependencies", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  provider: text("provider"),
  /** "healthy", "degraded", "down". */
  state: text("state").notNull().default("healthy"),
  note: text("note"),
  latencyMs: integer("latency_ms"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A post on an incident's timeline. */
export const incidentUpdates = pgTable(
  "incident_updates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    /** "investigating", "identified", "monitoring", "resolved". */
    stage: text("stage").notNull(),
    body: text("body").notNull(),
    authorName: text("author_name"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("incident_updates_incident_idx").on(t.incidentId, t.at)],
);

/* ─── CRM: leads and follow-ups ────────────────────────────────────────── */

/**
 * Where a lead is in the pipeline.
 *
 * Fixed keys, industry-specific words. A clinic calls `qualified` "appointment
 * booked" and an estate agent calls it "site visit fixed", but a report across
 * both still has to be able to count how many got that far — so the key is
 * shared and the label comes from `lib/business/industries.ts`.
 */
export const leadStageEnum = pgEnum("lead_stage", [
  "new",
  "contacted",
  "qualified",
  "proposal",
  "won",
  "lost",
]);

export const followUpStatusEnum = pgEnum("follow_up_status", ["open", "done", "cancelled"]);

/**
 * Someone who might become a customer, and what they came for.
 *
 * Most leads are written by the AI mid-call: a caller the brand does not know
 * says what they want, and the agent records it rather than letting it vanish
 * into a transcript nobody rereads. A lead points at the customer record the
 * call created, so the person and the opportunity stay one click apart.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** The conversation it came from, when it came from one. */
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    /** What they want, in a sentence: "2BHK near Whitefield under ₹90L". */
    interest: text("interest").notNull().default(""),
    notes: text("notes"),
    stage: leadStageEnum("stage").notNull().default("new"),
    /** What it is worth if won, when anyone knows. */
    valuePaise: integer("value_paise"),
    ownerMembershipId: uuid("owner_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    /** "phone", "web_chat", "whatsapp", "manual", … */
    source: text("source").notNull().default("manual"),
    createdByAi: boolean("created_by_ai").notNull().default(false),
    lostReason: text("lost_reason"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("leads_brand_stage_idx").on(t.brandId, t.stage),
    index("leads_owner_idx").on(t.ownerMembershipId),
    index("leads_customer_idx").on(t.customerId),
  ],
);

/**
 * Something a person promised to do, with a date and a name on it.
 *
 * "We'll call you back tomorrow" is the most common promise a helpline makes
 * and the one most often broken, because it lives in someone's head. The AI
 * writes these when it makes that promise on the business's behalf, and the
 * team screen counts which of them were kept on time.
 */
export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    detail: text("detail"),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    assigneeMembershipId: uuid("assignee_membership_id").references(() => memberships.id, {
      onDelete: "set null",
    }),
    status: followUpStatusEnum("status").notNull().default("open"),
    createdByName: text("created_by_name"),
    createdByAi: boolean("created_by_ai").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByName: text("completed_by_name"),
    outcome: text("outcome"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("follow_ups_brand_due_idx").on(t.brandId, t.status, t.dueAt),
    index("follow_ups_assignee_idx").on(t.assigneeMembershipId, t.status),
  ],
);
