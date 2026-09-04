"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { BRAND_COOKIE } from "@/lib/auth/brand";

/**
 * Put a different brand in view.
 *
 * The choice is a cookie rather than a path segment because it survives
 * navigation between the twelve screens, and because it is a preference, not
 * an address — two people looking at `/app/handoffs` are looking at the same
 * screen even if they have different brands selected.
 *
 * The membership's brand scope is re-checked here: a cookie is something the
 * browser sends, not something the server trusts.
 */
export async function switchBrand(brandId: string) {
  const { brands } = await getConsoleContext();
  if (!brands.some((b) => b.id === brandId)) {
    throw new Error("That brand is not in your workspace.");
  }

  const jar = await cookies();
  jar.set(BRAND_COOKIE, brandId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
}
