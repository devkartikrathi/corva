import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";
import { DEMO_MODE } from "@/lib/auth/mode";
import { SignOutLink } from "@/components/SignOutLink";

export const metadata = { title: "No workspace" };

/**
 * Reached when the app knows the person but no membership row does. Being
 * authenticated is not the same as being authorized, and this page is where
 * that distinction becomes visible rather than a confusing empty console.
 *
 * In demo mode it means the database has no business in it yet, which is a
 * different problem with a different fix.
 */
export default function NoWorkspacePage() {
  if (DEMO_MODE) {
    return (
      <AuthFrame
        kicker="Nothing to show yet"
        title="This workspace is empty"
        lede="Demo mode is on, so no sign-in is needed — but this database has no business in it yet. Set CORVA_DEMO_EMAIL to a member's email, or turn demo mode off, sign in, and create a business at /welcome."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
          <Link
            href="/"
            className="hov-invert"
            style={{
              fontSize: 13,
              fontWeight: 600,
              border: "2px solid var(--color-text)",
              padding: "12px 18px",
              color: "var(--color-text)",
            }}
          >
            Back to the site
          </Link>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame
      kicker="Not invited yet"
      title="No workspace for this account"
      lede="Your sign-in worked, but this email isn't a member of any Corva workspace. Ask an Owner or Admin to invite it, then sign in again."
    >
      <SignOutLink />
    </AuthFrame>
  );
}
