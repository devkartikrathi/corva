import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { BRAND_COOKIE, resolveBrand } from "./brand";
import type { brands } from "@/lib/db/schema";
import { demoEnabled, getDemoStaffSession, getDemoTenantSession } from "./demo";
import {
  getStaffSession,
  getTenantSession,
  getVisibleBrands,
  type StaffSession,
  type TenantSession,
} from "./session";

/**
 * The request context for each console: who is asking, and what they may see.
 *
 * Authorization lives here rather than in the proxy. Path matching can
 * diverge from how Next routes a request, so the check runs where the data is
 * actually read — every console page and layout starts by calling one of
 * these, and nothing is reachable without one.
 *
 * In demo mode a seeded member stands in for a Clerk session. Only identity
 * is substituted: brand scope and the role matrix apply either way.
 */

export type Brand = typeof brands.$inferSelect;

export type ConsoleContext = {
  session: TenantSession;
  /** Brands this membership may see, in creation order. */
  brands: Brand[];
  /** The brand currently in view — their selection, or the first they may see. */
  brand: Brand;
  /** True when no one actually signed in. Surfaced in the UI, not hidden. */
  isDemo: boolean;
};

export const getConsoleContext = cache(async (): Promise<ConsoleContext> => {
  const real = await getTenantSession();
  const session = real ?? (await getDemoTenantSession());

  if (!session) {
    // No Clerk session, and demo mode is off or the workspace is unseeded.
    redirect(demoEnabled() ? "/no-workspace" : "/sign-in?redirect_url=%2Fapp");
  }

  const visible = await getVisibleBrands(session);
  if (visible.length === 0) redirect("/no-workspace");

  const selected = (await cookies()).get(BRAND_COOKIE)?.value;
  return {
    session,
    brands: visible,
    brand: resolveBrand(visible, selected),
    isDemo: !real,
  };
});

/**
 * The operator console. Staff are a separate table, not a tenant role, so no
 * amount of editing an organization can reach this.
 */
export const requireStaff = cache(
  async (): Promise<{ staff: StaffSession; isDemo: boolean }> => {
    const real = await getStaffSession();
    const staff = real ?? (await getDemoStaffSession());

    if (!staff) {
      if (demoEnabled()) redirect("/no-workspace");
      // Not signed in: sign in, and come back. Signed in but not on the staff
      // list: say so, rather than bouncing them round the sign-in page.
      const { userId } = await auth();
      redirect(userId ? "/operator-closed" : "/sign-in?redirect_url=%2Foperator");
    }

    return { staff, isDemo: !real };
  },
);
