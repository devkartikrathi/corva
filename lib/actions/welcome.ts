"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { and, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { createBusiness } from "@/lib/business/onboard";
import { industryFor } from "@/lib/business/industries";

/**
 * A business setting itself up.
 *
 * Signed in, email verified, and not already in a business: that person
 * becomes the Owner of a new one on the 14-day pilot. The same code an
 * admin's onboarding runs — the business, its assistant from the industry
 * template, the knowledge read from its website, a line — only the Owner seat
 * is theirs straight away rather than an invitation.
 *
 * One business per person through this door. A second brand is added from
 * Settings, on a plan that covers it.
 */
export async function startBusiness(input: {
  businessName: string;
  industry: string;
  website: string;
  about: string;
  agentName: string;
  ownerName: string;
}): Promise<{ error: string } | never> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fwelcome");

  const user = await currentUser();
  const primary = user?.primaryEmailAddress;
  if (!primary || primary.verification?.status !== "verified") {
    return { error: "Verify your email address first, then come back to this page." };
  }
  const email = primary.emailAddress.toLowerCase();

  // Already in a business — or invited to one, which signing in will claim.
  const [existing] = await db
    .select({ id: s.memberships.id, status: s.memberships.status })
    .from(s.memberships)
    .where(and(sql`(${s.memberships.clerkUserId} = ${userId} or lower(${s.memberships.email}) = ${email})`, sql`${s.memberships.status} in ('active', 'invited')`))
    .limit(1);
  if (existing) redirect("/app");

  const businessName = input.businessName?.trim().slice(0, 80) ?? "";
  if (businessName.length < 2) return { error: "What is the business called?" };
  const about = (input.about ?? "").trim().slice(0, 12_000);
  const website = (input.website ?? "").trim().slice(0, 200);
  if (!website && about.length < 40) {
    return { error: "Give a website, or a few lines about what you offer — it is what the assistant answers from." };
  }
  const ownerName = input.ownerName?.trim().slice(0, 80) || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || email.split("@")[0];

  try {
    await createBusiness(
      {
        businessName,
        industry: industryFor(input.industry).key,
        agentName: input.agentName?.trim().slice(0, 30) || "",
        website,
        about,
        phoneNumber: "",
        ownerName,
        ownerEmail: email,
        team: "",
      },
      { staffId: userId, name: ownerName },
      { clerkUserId: userId },
    );
  } catch (e) {
    console.error("[welcome] could not create a business:", e);
    return { error: e instanceof Error ? e.message : "Something went wrong setting that up. Please try again." };
  }
  redirect("/app?welcome=1");
}

/** Whether this signed-in person still needs to set a business up. */
export async function needsBusiness(clerkUserId: string) {
  const [row] = await db
    .select({ id: s.memberships.id })
    .from(s.memberships)
    .where(and(eq(s.memberships.clerkUserId, clerkUserId), eq(s.memberships.status, "active")))
    .limit(1);
  return !row;
}
