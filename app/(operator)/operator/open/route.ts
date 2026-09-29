import { NextResponse, type NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/context";
import { enterAsBusiness } from "@/lib/auth/enter";
import { DEMO_MODE } from "@/lib/auth/mode";

/**
 * `/operator/open?brand=…&next=/app/live?call=…`
 *
 * A link rather than a button, so "watch this call in their console" can open
 * in a new tab from the dialer while the call carries on. Sets who the console
 * is looking as (demo mode only) and sends you on. `next` is confined to the
 * console so this cannot be used to bounce anyone elsewhere.
 */
export async function GET(req: NextRequest) {
  await requireStaff();
  const brandId = req.nextUrl.searchParams.get("brand") ?? undefined;
  const orgSlug = req.nextUrl.searchParams.get("org") ?? undefined;
  const next = req.nextUrl.searchParams.get("next") ?? "/app";

  const safe = next.startsWith("/app") ? next : "/app";
  // With real sign-in there is no one to become: go to the page and let the
  // person sign in as themselves (they see it if they are on that business).
  if (DEMO_MODE) await enterAsBusiness({ brandId, orgSlug });
  return NextResponse.redirect(new URL(safe, req.nextUrl.origin));
}
