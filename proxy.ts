import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { DEMO_MODE, OPERATOR_AVAILABLE } from "@/lib/auth/mode";

/**
 * Attaches Clerk's auth context to every request. It deliberately does *not*
 * decide who may see what: path matching in a proxy can diverge from how Next
 * routes a request, which leaves protected resources reachable. Authorization
 * happens where the data is read, in `lib/auth/context.ts`.
 *
 * In demo mode Clerk is not involved at all.
 */
/**
 * Corva's own console does not exist on a deployment (see OPERATOR_AVAILABLE).
 * The pages refuse too — this just answers before any of them runs.
 */
const operatorGone = (req: NextRequest) =>
  !OPERATOR_AVAILABLE && (req.nextUrl.pathname === "/operator" || req.nextUrl.pathname.startsWith("/operator/"))
    ? new NextResponse("Not found", { status: 404 })
    : undefined;

export default DEMO_MODE ? (req: NextRequest) => operatorGone(req) : clerkMiddleware((_auth, req) => operatorGone(req));

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
