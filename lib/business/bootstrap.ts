import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { reindex } from "@/lib/knowledge";
import { industryFor, defaultPersona, type Industry } from "./industries";
import { formatPhone, freeTestNumber, isPlausiblePhone, numberTaken } from "./phone";
import { readWebsite } from "./website";

/**
 * Making a brand answerable.
 *
 * A brand row on its own cannot take a call: the agent needs a live version
 * (persona, what it may do, when it hands over), something to answer from, and
 * a number to be reached on. This does all three in one go, so a business that
 * has just been created can be rung straight away — which is the demo, and is
 * also the honest test of whether onboarding worked.
 *
 * Not a server action. Onboarding calls it after its own permission check.
 */

const TRIGGERS = [
  {
    description: 'Caller mentions a complaint, lawyer or consumer court',
    rule: { kind: "phrase", any: ["complaint", "lawyer", "legal action", "consumer court", "police"] },
  },
  { description: "Asks for a human twice", rule: { kind: "human_requests", atLeast: 2 } },
  { description: "Sentiment drops below −0.40", rule: { kind: "sentiment", below: -0.4 } },
  { description: "Request exceeds an authority ceiling", rule: { kind: "authority_exceeded" } },
];

export type BootstrapInput = {
  brandId: string;
  businessName: string;
  agentName: string;
  industry: string;
  /** Anything the owner pasted: FAQs, prices, policies. */
  about?: string;
  website?: string;
  /** Empty means "give it a test number". */
  phoneNumber?: string;
  authorName: string;
};

export type BootstrapResult = {
  phoneNumber: string;
  documents: { title: string; chunks: number }[];
  /** Things that did not work but did not stop the business being created. */
  warnings: string[];
};

/** Validate a number before anything is written. */
export async function resolvePhoneNumber(requested: string | undefined, brandId?: string) {
  const wanted = requested?.trim();
  if (!wanted) return freeTestNumber();
  if (!isPlausiblePhone(wanted)) throw new Error("That phone number does not look right.");
  const clash = await numberTaken(wanted, brandId);
  if (clash) throw new Error(`${formatPhone(wanted)} is already ${clash}'s number.`);
  return formatPhone(wanted);
}

export async function createLiveAgent(opts: {
  brandId: string;
  businessName: string;
  agentName: string;
  industry: Industry;
  about?: string;
  authorName: string;
}) {
  const { brandId, businessName, agentName, industry, about, authorName } = opts;

  const [version] = await db
    .insert(s.agentVersions)
    .values({
      brandId,
      version: 1,
      persona: defaultPersona({ agentName, businessName, industry, about: about?.split("\n")[0] }),
      tone: { warmth: 7, brevity: 8, formality: 4, persistence: 3 },
      status: "live",
      notes: `Started from the ${industry.label} template`,
      authorName,
      publishedAt: new Date(),
    })
    .returning();

  await db.insert(s.authorityLimits).values(
    industry.authority.map((a) => ({
      agentVersionId: version.id,
      action: a.action,
      label: a.label,
      ceilingPaise: a.ceilingRupees === null ? null : a.ceilingRupees * 100,
      blocked: a.blocked ?? false,
      escalateTo: a.escalateTo ?? null,
    })),
  );
  await db.insert(s.escalationTriggers).values(
    TRIGGERS.map((t) => ({ agentVersionId: version.id, description: t.description, rule: t.rule })),
  );
  await db.insert(s.neverRules).values(
    industry.never.map((description) => ({ agentVersionId: version.id, description })),
  );
  return version;
}

async function publishDocument(opts: {
  brandId: string;
  title: string;
  collection: string;
  kind: string;
  body: string;
  sourceSystem?: string;
  authorName: string;
}) {
  const [doc] = await db
    .insert(s.documents)
    .values({
      brandId: opts.brandId,
      title: opts.title,
      collection: opts.collection,
      kind: opts.kind,
      body: opts.body,
      status: "published",
      ownerName: opts.authorName,
      updatedByName: opts.authorName,
      sourceSystem: opts.sourceSystem ?? null,
      revision: 1,
    })
    .returning();
  await db.insert(s.documentRevisions).values({
    documentId: doc.id,
    revision: 1,
    title: doc.title,
    body: doc.body,
    note: "Created during onboarding",
    authorName: opts.authorName,
  });
  const chunks = await reindex(doc.id, opts.brandId, opts.body);
  return { title: doc.title, chunks };
}

const DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const clock = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${mm}${h < 12 ? "am" : "pm"}`;
};

export async function bootstrapBusiness(input: BootstrapInput): Promise<BootstrapResult> {
  const industry = industryFor(input.industry);
  const warnings: string[] = [];
  const phoneNumber = await resolvePhoneNumber(input.phoneNumber, input.brandId);

  const [existing] = await db
    .select({ id: s.agentVersions.id })
    .from(s.agentVersions)
    .where(and(eq(s.agentVersions.brandId, input.brandId), eq(s.agentVersions.status, "live")))
    .limit(1);
  if (!existing) {
    await createLiveAgent({
      brandId: input.brandId,
      businessName: input.businessName,
      agentName: input.agentName,
      industry,
      about: input.about,
      authorName: input.authorName,
    });
  }

  // What the business told us, plus the few facts every caller asks.
  const hours = await db
    .select()
    .from(s.businessHours)
    .where(eq(s.businessHours.brandId, input.brandId))
    .orderBy(s.businessHours.weekday);
  const hoursLine = hours
    .map((h) => `${DAY[h.weekday]} ${h.closed ? "closed" : `${clock(h.opensMinute)}–${clock(h.closesMinute)}`}`)
    .join(", ");

  const documents: BootstrapResult["documents"] = [];
  const aboutParagraphs = (input.about ?? "")
    .split(/\n{2,}|\n(?=[A-Z][^:\n]{2,30}:)/)
    .map((p) => p.trim())
    .filter(Boolean);
  documents.push(
    await publishDocument({
      brandId: input.brandId,
      title: `About ${input.businessName}`,
      collection: "Business basics",
      kind: "Reference",
      body: [
        `About: ${industry.describe(input.businessName)}`,
        `Contact: The phone number is ${phoneNumber}.`,
        hoursLine && `Opening hours: ${hoursLine}.`,
        ...aboutParagraphs,
        ...industry.starter,
      ]
        .filter(Boolean)
        .join("\n\n"),
      authorName: input.authorName,
    }),
  );

  if (input.website?.trim()) {
    try {
      const site = await readWebsite(input.website, input.businessName);
      if (site.body.trim()) {
        documents.push(
          await publishDocument({
            brandId: input.brandId,
            title: `From ${new URL(site.url).hostname}`,
            collection: "Website",
            kind: "Reference",
            body: site.body,
            sourceSystem: site.url,
            authorName: input.authorName,
          }),
        );
        if (!site.rewritten) warnings.push("The website was read as plain text — the AI tidy-up was unavailable.");
      } else {
        warnings.push("The website had no readable text.");
      }
    } catch (e) {
      warnings.push((e as Error).message);
    }
  }

  // The number the business answers on, and web chat so the text path works too.
  await db
    .insert(s.channels)
    .values([
      { brandId: input.brandId, kind: "phone", address: phoneNumber, detail: phoneNumber, state: "live" },
      { brandId: input.brandId, kind: "web_chat", address: null, detail: "Chat widget", state: "live" },
    ])
    .onConflictDoNothing();

  await db
    .update(s.brands)
    .set({ isLive: true, agentName: input.agentName, industry: industry.key })
    .where(eq(s.brands.id, input.brandId));

  return { phoneNumber, documents, warnings };
}
