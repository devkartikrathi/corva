import { auth, currentUser } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { DEMO_MODE } from "@/lib/auth/mode";

/**
 * Who runs Corva.
 *
 * `/admin` is the one place that sees every business — plans, usage, payments,
 * demo requests — so it is not a role inside any business. It is an allowlist:
 * the verified emails in `CORVA_ADMIN_EMAILS`. Anyone else gets a 404, the
 * same as if the page did not exist.
 *
 * It never opens a business's conversations or customers; those stay inside
 * the business's own console.
 */

export const adminEmails = () =>
  (process.env.CORVA_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export type Admin = { email: string; name: string };

export const requireAdmin = cache(async (): Promise<Admin> => {
  // Local demo mode has no sign-in at all; it is never on in production.
  if (DEMO_MODE) return { email: "demo@localhost", name: "Demo admin" };

  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=%2Fadmin");
  const user = await currentUser();
  const primary = user?.primaryEmailAddress;
  const email = primary?.emailAddress.toLowerCase();
  if (!email || primary?.verification?.status !== "verified" || !adminEmails().includes(email)) notFound();
  return { email, name: [user?.firstName, user?.lastName].filter(Boolean).join(" ") || email };
});
