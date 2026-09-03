import { clerkMiddleware } from "@clerk/nextjs/server";
import { DEMO_MODE } from "@/lib/auth/mode";

/**
 * Attaches Clerk's auth context to every request. It deliberately does *not*
 * decide who may see what: path matching in a proxy can diverge from how Next
 * routes a request, which leaves protected resources reachable. Authorization
 * happens where the data is read, in `lib/auth/context.ts`.
 *
 * In demo mode this is a passthrough.
 */
export default DEMO_MODE ? () => undefined : clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
