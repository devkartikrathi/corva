import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { BRAND_COOKIE, resolveBrand } from "./brand";
import type { brands } from "@/lib/db/schema";
import { demoEnabled, getDemoTenantSession } from "./demo";
import { getTenantSession, getVisibleBrands, type TenantSession } from "./session";
import { viewAsSession } from "./view-as";

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
  /**
   * Set when an owner is looking at the console as one of their test
   * accounts: who they really are. `session` is then the test account.
   */
  viewingAs: { realName: string; realMembershipId: string } | null;
};

export const getConsoleContext = cache(async (): Promise<ConsoleContext> => {
  const real = await getTenantSession();
  // An owner looking through a test account's eyes — see ./view-as.ts.
  const viewing = real ? await viewAsSession(real) : null;
  const session = viewing ?? real ?? (await getDemoTenantSession());

  if (!session) {
    if (demoEnabled()) redirect("/no-workspace");
    // Signed in but in no business yet: they set one up. Not signed in: sign in.
    const { userId } = await auth();
    redirect(userId ? "/welcome" : "/sign-in?redirect_url=%2Fapp");
  }

  const visible = await getVisibleBrands(session);
  if (visible.length === 0) redirect("/no-workspace");

  const selected = (await cookies()).get(BRAND_COOKIE)?.value;
  return {
    session,
    brands: visible,
    brand: resolveBrand(visible, selected),
    isDemo: !real,
    viewingAs: viewing && real ? { realName: real.name, realMembershipId: real.membershipId } : null,
  };
});
