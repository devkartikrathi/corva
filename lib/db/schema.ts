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
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
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
  /**
   * What the business is on: "pilot" (the free start), "starter", "growth" or
   * "business". The catalogue — prices, included usage, limits — is
   * lib/billing/plans.ts. (`plan` above is the old enum, no longer read.)
   */
  tier: text("tier").notNull().default("pilot"),
  /** The paid-for (or pilot) period usage is counted in. */
  periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
  /** When it runs out. Null on rows from before plans: read as period start + the pilot's length. */
  periodEnd: timestamp("period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Money received, one row per Razorpay payment.
 *
 * Written twice on purpose — by the browser's verified callback and by
 * Razorpay's webhook — and keyed on the payment id so the second is an update,
 * not a duplicate. The webhook is the one that grants the plan: it arrives
 * even when the payer closes the tab.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
    razorpayPaymentId: text("razorpay_payment_id").notNull().unique(),
    razorpayOrderId: text("razorpay_order_id").notNull(),
    /** verified | captured | failed | refunded | disputed */
    status: text("status").notNull(),
    tier: text("tier"),
    /** Everything charged, in paise: plan + overage + GST. */
    amountPaise: integer("amount_paise").notNull(),
    planPaise: integer("plan_paise").notNull().default(0),
    overagePaise: integer("overage_paise").notNull().default(0),
    gstPaise: integer("gst_paise").notNull().default(0),
    method: text("method"),
    email: text("email"),
    paidByName: text("paid_by_name"),
    /** Whether this payment has already moved the organization's plan. */
    granted: boolean("granted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_org_idx").on(t.orgId)],
);

/** Someone asked for a demo on the public site. Emailed to Corva's admins, and kept here. */
export const demoRequests = pgTable("demo_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  business: text("business"),
  industry: text("industry"),
  website: text("website"),
  message: text("message"),
  /** new | contacted | closed */
  status: text("status").notNull().default("new"),
  emailed: boolean("emailed").notNull().default(false),
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

/* ─── Products & services ──────────────────────────────────────────────── */

/**
 * A group in a business's catalog: "Dry cleaning", and inside it "Men's wear".
 *
 * Groups nest to any depth through `parentId`, because no two businesses cut
 * their offer the same way — a laundromat goes service › garment type › item,
 * a clinic goes department › treatment, a shop goes aisle › brand › product.
 * Deleting a group deletes everything under it.
 */
export const catalogCategories = pgTable(
  "catalog_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => catalogCategories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Anything true of the whole group: turnaround, conditions, what is included. */
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("catalog_categories_brand_idx").on(t.brandId, t.parentId, t.position)],
);

/**
 * One thing a business sells: a service it performs or a product it hands over.
 *
 * Deliberately few columns. A price, the unit it is quoted in, and a free-text
 * description that carries everything else — turnaround, sizes, what is and
 * is not included — in the business's own words, which is what the AI quotes.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Null for an item that sits at the top level, outside any group. */
    categoryId: uuid("category_id").references(() => catalogCategories.id, { onDelete: "cascade" }),
    /** "service" | "product" */
    kind: text("kind").notNull().default("service"),
    name: text("name").notNull(),
    /** Null means the price is not fixed: the AI says it is quoted, never guesses. */
    pricePaise: integer("price_paise"),
    /** What the price is for: "per kg", "per piece", "onwards". Free text. */
    priceUnit: text("price_unit"),
    description: text("description"),
    /** Off for something not offered right now; the AI says so rather than selling it. */
    available: boolean("available").notNull().default(true),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("catalog_items_brand_idx").on(t.brandId, t.categoryId, t.position)],
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
     * The details the business asked the AI to collect, as found out in this
     * conversation: `{ address: "B-402 Palm Grove…", request_type: "Dry-cleaning" }`.
     * Keys are the business's intake fields (see `intakeFields`). Kept here as
     * well as on the lead so the person taking the line sees them mid-call.
     */
    captured: jsonb("captured").$type<Record<string, string>>().notNull().default({}),
    /**
     * The id another system gave this conversation — e.g. a website chat
     * session — so it can be updated as it goes rather than duplicated.
     */
    externalRef: text("external_ref"),
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
    uniqueIndex("conversations_brand_external_idx").on(t.brandId, t.externalRef),
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

/* ─── Quality ──────────────────────────────────────────────────────────── */

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
    /** The business's intake fields as collected for this request. */
    details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
    /**
     * The latest request on this lead, as fields rather than a sentence:
     * `{ kind, reference, services, address, date, timeSlot, preferredTime,
     * topic, promoCode }`. `interest` says the same thing for a person to read;
     * this is for the business's own systems, over the API and webhooks.
     */
    request: jsonb("request").$type<Record<string, unknown>>(),
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

/* ─── Integrations: API keys, website visitors ─────────────────────────── */

/**
 * A key a business's own systems use to talk to Corva — their website's chat,
 * their booking form.
 *
 * Only a hash is stored. The key itself is shown once, when it is made, and
 * the first characters are kept so a list of keys can say which is which
 * without being able to reconstruct any of them.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** e.g. "ck_7Fq2" — enough to tell keys apart, not enough to use one. */
    prefix: text("prefix").notNull(),
    /** SHA-256 of the full key, hex. */
    hash: text("hash").notNull().unique(),
    createdByName: text("created_by_name"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("api_keys_brand_idx").on(t.brandId)],
);

/**
 * What a business wants its AI to find out from every customer.
 *
 * A laundry needs the pickup address and what needs cleaning; a clinic needs
 * the patient's age and symptoms; a builder the budget and the site. The
 * business keeps this list (Details to collect), the agent asks for each one
 * naturally in chat and on calls and records the answers as it hears them,
 * and whoever picks the customer up sees them filled in rather than reading
 * a transcript to find out.
 *
 * Name, phone and email are built in: they are also the customer record's own
 * columns. Everything else is the business's own.
 */
export const intakeFields = pgTable(
  "intake_fields",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Stable id the values are stored under: "address", "request_type". */
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** What to ask, or how to fill it in — read by the AI. */
    hint: text("hint"),
    /** text | phone | email | address | choice | date | number */
    kind: text("kind").notNull().default("text"),
    /** For `choice`: the answers allowed. */
    options: jsonb("options").$type<string[]>().notNull().default([]),
    required: boolean("required").notNull().default(false),
    position: integer("position").notNull().default(0),
    builtIn: boolean("built_in").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("intake_fields_brand_key_idx").on(t.brandId, t.key)],
);

/**
 * Something the agent offered to do in a web chat, waiting on the customer.
 *
 * A booking or a callback is only made when the person taps Confirm on the
 * card their site shows — not when the model decides it has enough details —
 * so what the agent proposed is kept here until they answer. The details are
 * checked when proposed and again, unchanged, when confirmed.
 */
export const chatProposals = pgTable(
  "chat_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** "booking" or "callback". */
    kind: text("kind").notNull(),
    details: jsonb("details").notNull(),
    /** pending → confirmed | declined | superseded */
    status: text("status").notNull().default("pending"),
    /** What confirming it produced: reference, owner, emailed. */
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("chat_proposals_conversation_idx").on(t.conversationId)],
);

/**
 * Where Corva tells a business's own systems what just happened.
 *
 * The API is how a business's website talks to Corva; a webhook is the other
 * direction — a new lead, a follow-up, a handoff, posted to a URL the business
 * gives us, signed with a secret only they hold so they can trust it came from
 * here. The last delivery's result is kept so a broken endpoint is visible in
 * Settings rather than discovered weeks later.
 */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    /** Signs every delivery (HMAC-SHA256). Shown once, when the webhook is made. */
    secret: text("secret").notNull(),
    /** Event types to send; empty means all of them. */
    events: jsonb("events").$type<string[]>().notNull().default([]),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
    /** HTTP status of the last delivery; 0 when it could not connect. */
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    /** Deliveries failed in a row. Reset by a success. */
    failures: integer("failures").notNull().default(0),
  },
  (t) => [index("webhooks_brand_idx").on(t.brandId)],
);

/* ─── Email by forwarding ──────────────────────────────────────────────── */

/**
 * A business's Corva email address: where it forwards customer mail, and
 * where customers' replies to Corva's emails come back to.
 *
 * Mail arrives through Resend's inbound webhook the moment it is forwarded —
 * no inbox password, no polling. See lib/email/inbound.ts.
 */
export const emailInboxes = pgTable("email_inboxes", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  /** The part before the @: "tumbledays-7k3q". */
  localPart: text("local_part").notNull().unique(),
  /**
   * Gmail's (or another provider's) "confirm you may forward here" message,
   * caught on arrival so the business can read the code in Corva.
   */
  confirmation: jsonb("confirmation").$type<{ code: string | null; link: string | null; from: string; at: string }>(),
  received: integer("received").notNull().default(0),
  kept: integer("kept").notNull().default(0),
  lastReceivedAt: timestamp("last_received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Each email in or out of a thread: for threading replies and for taking a delivery once. */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    /** "in" (from a customer) or "out" (sent from Corva). */
    direction: text("direction").notNull(),
    /** Resend's id for the email; a webhook delivered twice is taken once. */
    providerId: text("provider_id").unique(),
    /** The Message-ID header, without angle brackets. */
    messageId: text("message_id"),
    /** The customer's address on the thread. */
    address: text("address"),
    subject: text("subject"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_messages_conversation_idx").on(t.conversationId), index("email_messages_message_idx").on(t.brandId, t.messageId)],
);

/* ─── SMS ──────────────────────────────────────────────────────────────── */

/**
 * How a business sends SMS: its provider, sender id and (sealed) credentials.
 *
 * In India every SMS must come from a DLT-registered sender and match an
 * approved template, so the assistant never writes free-form SMS — it fills
 * a template (`sms_templates`). See docs/TELEPHONY.md, Part 2.
 */
export const smsSettings = pgTable("sms_settings", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  /** "msg91" | "twilio" | "log" (sends nothing; for testing). */
  provider: text("provider").notNull().default("log"),
  enabled: boolean("enabled").notNull().default(false),
  /** DLT header ("TMBLDY") or, for Twilio, the sending number / messaging service. */
  senderId: text("sender_id"),
  /** The business's DLT principal entity id. */
  dltEntityId: text("dlt_entity_id"),
  /** Provider credentials as JSON, sealed (lib/data/crypto.ts). Never sent back to the browser. */
  credentials: text("credentials"),
  updatedByName: text("updated_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One approved message per purpose: its words with `{#var#}` slots, and its DLT ids. */
export const smsTemplates = pgTable(
  "sms_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** "payment_link" | "booking_confirmed" | "callback_arranged" | "missed_call" | "order_update" */
    purpose: text("purpose").notNull(),
    /** Exactly as approved on DLT, with `{#var#}` for each variable. */
    body: text("body").notNull(),
    dltTemplateId: text("dlt_template_id"),
    /** The provider's own id for it, where it has one (MSG91 Flow template id). */
    providerTemplateId: text("provider_template_id"),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sms_templates_brand_purpose_idx").on(t.brandId, t.purpose)],
);

/** Every SMS sent, or tried: what, to whom, why, and what the provider said. */
export const smsMessages = pgTable(
  "sms_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    to: text("to").notNull(),
    purpose: text("purpose").notNull(),
    body: text("body").notNull(),
    provider: text("provider").notNull(),
    /** "sent" | "failed" | "delivered" | "logged" (the log provider) */
    status: text("status").notNull(),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentByName: text("sent_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sms_messages_brand_idx").on(t.brandId, t.createdAt), index("sms_messages_customer_idx").on(t.customerId)],
);

/* ─── Collecting payments from customers ───────────────────────────────── */

/**
 * Where a business makes payment links: an endpoint in its own system.
 *
 * The money is the business's — its own payment account, its own books — so
 * Corva never holds the keys. When the team or the assistant asks a customer
 * to pay, Corva calls this URL (signed like a webhook, with `secret`) and is
 * handed back a link. See docs/PAYMENTS.md.
 */
export const paymentEndpoints = pgTable("payment_endpoints", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  /** Signs every request (HMAC-SHA256, the webhook scheme). Shown once. */
  secret: text("secret").notNull(),
  createdByName: text("created_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastCalledAt: timestamp("last_called_at", { withTimezone: true }),
  /** HTTP status of the last call; 0 when it could not connect. */
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
});

/**
 * Corva collecting payments for a business that has no payment system.
 *
 * The link is made on Corva's own Razorpay account and the money lands
 * there; Corva owes it to the business, less `feeBasisPoints`, and pays it
 * out (by hand today; Razorpay Route to `routeAccountId` later). Switched on
 * by Corva, not by the business, because it makes Corva answerable for the
 * money. A business with its own endpoint never uses this.
 */
export const collectionSettings = pgTable("collection_settings", {
  brandId: uuid("brand_id")
    .primaryKey()
    .references(() => brands.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  /** Corva's cut, in hundredths of a percent: 200 = 2%. */
  feeBasisPoints: integer("fee_basis_points").notNull().default(0),
  /** The business's Razorpay Route linked account ("acc_…"), once it has one. */
  routeAccountId: text("route_account_id"),
  /** Where a manual payout goes, as the business gave it: "UPI kartik@okicici". */
  payoutNote: text("payout_note"),
  enabledByName: text("enabled_by_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A payment a business asked one of its customers for, as the business last
 * reported it.
 *
 * Mirrored, never decided here: the business's system says what was asked
 * and whether it was paid (POST /api/v1/payments). Kept so the customer's
 * record shows it, the conversation it was asked in can say "received", and
 * the assistant can answer "has my payment gone through?".
 */
export const customerPayments = pgTable(
  "customer_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
    /** Corva's id for the request, when Corva asked; the business echoes it back. */
    requestId: text("request_id").unique(),
    /** The business's reference: "PAY-7K3QX9". */
    reference: text("reference").notNull(),
    /** pending | partially_paid | paid | expired | cancelled | failed */
    status: text("status").notNull().default("pending"),
    amountPaise: integer("amount_paise").notNull(),
    amountPaidPaise: integer("amount_paid_paise").notNull().default(0),
    description: text("description"),
    /** The link the customer opens, and the business's own page and QR for it. */
    url: text("url"),
    pageUrl: text("page_url"),
    qrUrl: text("qr_url"),
    method: text("method"),
    orderReference: text("order_reference"),
    requestedByName: text("requested_by_name"),
    requestedByAi: boolean("requested_by_ai").notNull().default(false),
    /**
     * Who holds the money: "business" (its own payment system made the link)
     * or "corva" (Corva's own account collected it on the business's behalf,
     * and owes it to them — see docs/PAYMENTS.md, "Collected by Corva").
     */
    collectedBy: text("collected_by").notNull().default("business"),
    /** The provider's id for the link, when Corva made it ("plink_…"). */
    providerLinkId: text("provider_link_id"),
    providerPaymentId: text("provider_payment_id"),
    /** Corva's fee on a payment it collected, in paise; the rest is the business's. */
    feePaise: integer("fee_paise"),
    /** When what Corva collected was paid out to the business, and the transfer's reference. */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settlementRef: text("settlement_ref"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_payments_brand_ref_idx").on(t.brandId, t.reference),
    index("customer_payments_customer_idx").on(t.customerId, t.createdAt),
    index("customer_payments_conversation_idx").on(t.conversationId),
  ],
);

/**
 * Someone who has been on a business's website.
 *
 * Keyed by the first-party visitor id the site sets (a strictly necessary
 * cookie: it is what keeps a chat going across pages). Everything beyond that
 * id — which pages, where they came from — is only recorded when the visitor
 * has consented to analytics, and `consent` says which they chose.
 */
export const visitors = pgTable(
  "visitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** The site's own visitor id, from its cookie. */
    externalId: text("external_id").notNull(),
    /** Set once they tell us who they are — a lead, a callback, a booking. */
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    /** "necessary" or "all". */
    consent: text("consent").notNull().default("necessary"),
    pageViews: integer("page_views").notNull().default(0),
    firstReferrer: text("first_referrer"),
    /** utm_source / utm_medium / utm_campaign from the first visit. */
    firstUtm: jsonb("first_utm").notNull().default({}),
    lastPath: text("last_path"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("visitors_brand_external_idx").on(t.brandId, t.externalId),
    index("visitors_customer_idx").on(t.customerId),
  ],
);

/** What a visitor did on the site: a page, a chat, a request. */
export const visitorEvents = pgTable(
  "visitor_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    /** "page_view", "chat_started", "callback_requested", "pickup_requested", "voice_call". */
    type: text("type").notNull(),
    path: text("path"),
    meta: jsonb("meta").notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visitor_events_visitor_idx").on(t.visitorId, t.at)],
);

/**
 * A database the business runs itself, connected so the assistant can answer
 * from it.
 *
 * Corva never copies the data: it keeps the connection (encrypted) and a
 * snapshot of the table and column names, and reads on demand. One per
 * business for now.
 */
export const dataSources = pgTable(
  "data_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** postgres, for now. */
    kind: text("kind").notNull().default("postgres"),
    name: text("name").notNull(),
    /** The connection string, sealed with DATA_SOURCE_KEY. Never sent to a browser. */
    connection: text("connection").notNull(),
    /** Shown in Settings so the business can tell which database this is. */
    host: text("host").notNull(),
    databaseName: text("database_name").notNull(),
    /** Tables and columns as last read: what the AI is shown when it writes a query. */
    snapshot: jsonb("snapshot").$type<{ tables: { schema: string; name: string; columns: { name: string; type: string }[] }[] }>().notNull().default({ tables: [] }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("data_sources_brand_idx").on(t.brandId)],
);

/**
 * A question the assistant may put to a connected database.
 *
 * The query is fixed and written (or approved) by the business; the assistant
 * only supplies the values for its parameters. That is what makes it safe to
 * offer to a stranger on the website: they can ask about one order, never for
 * the table.
 */
export const dataLookups = pgTable(
  "data_lookups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    /** What the assistant calls it: "order_status". */
    key: text("key").notNull(),
    name: text("name").notNull(),
    /** When to use it — read by the AI. */
    description: text("description").notNull().default(""),
    /** A single SELECT, with `:name` where a parameter goes. */
    sql: text("sql").notNull(),
    params: jsonb("params").$type<{ name: string; description: string; kind: "text" | "phone" | "number" }[]>().notNull().default([]),
    /** Off until the business turns it on; a suggestion is only a draft. */
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("data_lookups_brand_key_idx").on(t.brandId, t.key)],
);

/**
 * A person's working day.
 *
 * One row per person per day, made when they clock in or when a manager marks
 * the day. Kept apart from `availability`, which is "can I be handed a call
 * this minute": someone can be at work and busy, and the record of having
 * been at work must not change when they step away from the queue.
 */
export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    /** The calendar day in India, as YYYY-MM-DD. */
    day: date("day").notNull(),
    /** present | half_day | leave | absent */
    status: text("status").notNull().default("present"),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    note: text("note"),
    /** Set when someone other than the person themselves recorded the day. */
    markedByName: text("marked_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("attendance_member_day_idx").on(t.membershipId, t.day), index("attendance_org_day_idx").on(t.orgId, t.day)],
);

/**
 * A business's own email inbox, connected so customers who write in are seen
 * alongside the ones who call or chat.
 *
 * Corva reads new mail over IMAP, keeps only what a customer wrote (and the
 * business's replies to them), and discards the rest unread: newsletters,
 * receipts and colleagues are nobody's customer record. One per business for
 * now.
 */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    host: text("host").notNull(),
    username: text("username").notNull(),
    /** The mailbox password or app password, sealed with DATA_SOURCE_KEY. */
    secret: text("secret").notNull(),
    /** How far each folder has been read: IMAP's uid and the validity it belongs to. */
    cursor: jsonb("cursor").$type<{ inbox?: { validity: string; uid: number }; sent?: { validity: string; uid: number } }>().notNull().default({}),
    /** Messages looked at, and how many were from customers. */
    seen: integer("seen").notNull().default(0),
    kept: integer("kept").notNull().default(0),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /** Set while a sync is running, so two do not read the same mail twice. */
    syncingSince: timestamp("syncing_since", { withTimezone: true }),
    lastError: text("last_error"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mailboxes_brand_idx").on(t.brandId)],
);

/**
 * A business's WhatsApp number, connected through Meta's WhatsApp Cloud API.
 *
 * The business owns the number and the Meta app; Corva holds the means to
 * answer on it (sealed) and is told about incoming messages by Meta's webhook.
 * One per business for now.
 */
export const whatsappNumbers = pgTable(
  "whatsapp_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Meta's id for the number: what a webhook names, and what a reply is sent from. */
    phoneNumberId: text("phone_number_id").notNull(),
    /** The number as customers see it, as Meta reports it. */
    displayNumber: text("display_number").notNull(),
    verifiedName: text("verified_name"),
    /** The access token, sealed with DATA_SOURCE_KEY. */
    token: text("token").notNull(),
    /** The Meta app's secret, sealed: proves a webhook really came from Meta. */
    appSecret: text("app_secret").notNull(),
    /** What the business pastes into Meta beside the webhook address. */
    verifyToken: text("verify_token").notNull(),
    /** Set when Meta has confirmed the webhook address. */
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdByName: text("created_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("whatsapp_numbers_brand_idx").on(t.brandId),
    uniqueIndex("whatsapp_numbers_phone_idx").on(t.phoneNumberId),
    uniqueIndex("whatsapp_numbers_verify_idx").on(t.verifyToken),
  ],
);

/** Messages already handled. Meta delivers a webhook more than once; a customer is answered once. */
export const whatsappSeen = pgTable("whatsapp_seen", {
  messageId: text("message_id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Counters for rate limits that have to hold across every server instance.
 *
 * One row per key per window. Old windows are swept by the scheduled job.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
