import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { DEMO_MODE } from "@/lib/auth/mode";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { DEFAULT_MODEL_ID, isKnownModel } from "@/lib/agent/models";
import { bootstrapBusiness, resolvePhoneNumber } from "./bootstrap";
import { industryFor } from "./industries";
import { inviteEmail, sendEmail } from "@/lib/email";
import { ROLE_LABELS } from "@/lib/auth/permissions";

/**
 * Adding a business.
 *
 * The end of this is a business that can be rung. Staff enter what the
 * business is, where its website lives and anything the owner wants the agent
 * to know; this creates the company, its agent, its knowledge and its number,
 * and hands back the number so the next thing anyone does is call it.
 *
 * In demo mode the people are created as active members rather than invites,
 * because there is no sign-in to accept an invite with — and a business nobody
 * can open is not something you can show anyone.
 *
 * Not a server action: the action in lib/actions/onboarding.ts checks that a
 * staff member is asking and then calls this.
 */

/** Mon–Sat 09:00–19:00, closed Sunday — a typical Indian shopfront. */
const DEFAULT_HOURS = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensMinute: 540,
  closesMinute: 1140,
  closed: weekday === 6,
}));

const ROLES = ["owner", "admin", "manager", "agent", "analyst"] as const;
type Role = (typeof ROLES)[number];

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "??";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Name, email, role" per line. Role is optional and defaults to agent.
 * Lines that do not parse are reported rather than silently dropped.
 */
function parseTeam(text: string) {
  const people: { name: string; email: string; role: Role }[] = [];
  const skipped: string[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, email, role] = line.split(/\s*[,|\t]\s*/);
    const r = (role ?? "agent").toLowerCase() as Role;
    if (!name || !email || !EMAIL.test(email) || !ROLES.includes(r) || r === "owner") {
      skipped.push(line);
      continue;
    }
    people.push({ name, email: email.toLowerCase(), role: r });
  }
  return { people, skipped };
}

export type OnboardingResult = {
  orgSlug: string;
  orgName: string;
  brandName: string;
  agentName: string;
  industry: string;
  phoneNumber: string;
  ownerEmail: string;
  /** Null in demo mode, where the Owner is active straight away. */
  inviteToken: string | null;
  people: number;
  documents: { title: string; chunks: number }[];
  warnings: string[];
};

export type OnboardingInput = {
  businessName: string;
  industry: string;
  agentName: string;
  website: string;
  about: string;
  phoneNumber: string;
  ownerName: string;
  ownerEmail: string;
  team: string;
};

export async function createBusiness(
  input: OnboardingInput,
  staff: { staffId: string; name: string },
): Promise<OnboardingResult> {
  const businessName = input.businessName.trim();
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerName = input.ownerName.trim() || ownerEmail.split("@")[0];
  const agentName = input.agentName.trim() || "Asha";
  const industry = industryFor(input.industry);

  if (!businessName) throw new Error("The business needs a name.");
  if (!EMAIL.test(ownerEmail)) throw new Error("The owner's email is not an email address.");
  const team = parseTeam(input.team);
  if (team.people.some((p) => p.email === ownerEmail)) throw new Error("The owner is listed in the team as well.");

  // Checked before anything is written, so a taken number does not leave a
  // half-made business behind.
  const phoneNumber = await resolvePhoneNumber(input.phoneNumber);

  // A clash on the address is not the operator's problem to solve.
  const base = slugify(businessName) || "business";
  let slug = base;
  for (let n = 2; ; n++) {
    const [clash] = await db
      .select({ id: s.organizations.id })
      .from(s.organizations)
      .where(eq(s.organizations.slug, slug))
      .limit(1);
    if (!clash) break;
    slug = `${base}-${n}`;
  }

  const modelId = isKnownModel(DEFAULT_MODEL_ID) ? DEFAULT_MODEL_ID : undefined;

  const [org] = await db
    .insert(s.organizations)
    .values({
      slug,
      name: businessName,
      plan: "trial",
      region: "ap-south-1",
      seatCount: 1 + team.people.length,
      mrrPaise: 0,
      healthScore: null,
      renewsAt: new Date(Date.now() + 30 * 864e5),
    })
    .returning();

  const [brand] = await db
    .insert(s.brands)
    .values({
      orgId: org.id,
      slug: slugify(businessName) || "main",
      name: businessName,
      initials: initialsOf(businessName),
      segment: industry.label,
      industry: industry.key,
      agentName,
      timezone: "Asia/Kolkata",
      ...(modelId ? { modelId } : {}),
      isLive: false,
    })
    .returning();

  await db.insert(s.businessHours).values(DEFAULT_HOURS.map((h) => ({ brandId: brand.id, ...h })));

  await db.insert(s.privacySettings).values({
    orgId: org.id,
    retentionDays: 365,
    redactPii: true,
    trainOnTranscripts: false,
    recordCalls: true,
    dataRegion: org.region,
    allowSupportAccess: true,
    updatedByName: staff.name,
  });

  const inviteToken = DEMO_MODE ? null : randomUUID();
  const member = (p: { name: string; email: string; role: Role }, token: string | null) => ({
    orgId: org.id,
    clerkUserId: DEMO_MODE ? `demo:${p.email}` : null,
    email: p.email,
    name: p.name,
    role: p.role,
    status: DEMO_MODE ? ("active" as const) : ("invited" as const),
    inviteToken: token,
    invitedByName: `${staff.name} (Corva)`,
    allBrands: true,
    // Present and ready in a demo, so a handoff has someone to ring.
    availability: DEMO_MODE ? ("available" as const) : ("offline" as const),
    invitedAt: new Date(),
  });

  await db.insert(s.memberships).values([
    member({ name: ownerName, email: ownerEmail, role: "owner" }, inviteToken),
    ...team.people.map((p) => member(p, DEMO_MODE ? null : randomUUID())),
  ]);

  const setup = await bootstrapBusiness({
    brandId: brand.id,
    businessName,
    agentName,
    industry: industry.key,
    about: input.about,
    website: input.website,
    phoneNumber,
    authorName: staff.name,
  });
  // With real sign-in, the Owner and team get their invitations by email.
  if (!DEMO_MODE) {
    const invited = await db
      .select({ email: s.memberships.email, role: s.memberships.role, token: s.memberships.inviteToken })
      .from(s.memberships)
      .where(eq(s.memberships.orgId, org.id));
    let unsent = 0;
    for (const m of invited) {
      if (!m.token) continue;
      const mail = inviteEmail({ orgName: businessName, role: ROLE_LABELS[m.role], invitedBy: `${staff.name} at Corva`, token: m.token });
      const r = await sendEmail({ to: m.email, ...mail });
      if (!r.sent) unsent++;
    }
    if (unsent) setup.warnings.push(`${unsent} invitation email${unsent === 1 ? "" : "s"} could not be sent — share the invite link instead.`);
  }
  if (team.skipped.length) {
    setup.warnings.push(`Skipped team lines that did not read as "Name, email, role": ${team.skipped.join("; ")}`);
  }

  await db.insert(s.auditLog).values({
    orgId: org.id,
    brandId: brand.id,
    actorType: "staff",
    actorId: staff.staffId,
    actorName: staff.name,
    action: "workspace.created",
    target: businessName,
    meta: {
      industry: industry.key,
      phone: setup.phoneNumber,
      owner: ownerEmail,
      team: team.people.length,
      documents: setup.documents.length,
    },
  });

  return {
    orgSlug: org.slug,
    orgName: org.name,
    brandName: brand.name,
    agentName,
    industry: industry.label,
    phoneNumber: setup.phoneNumber,
    ownerEmail,
    inviteToken,
    people: 1 + team.people.length,
    documents: setup.documents,
    warnings: setup.warnings,
  };
}

