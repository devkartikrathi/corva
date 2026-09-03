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
 * In demo mode it means the database has not been seeded, which is a
 * different problem with a different fix.
 */
export default function NoWorkspacePage() {
  if (DEMO_MODE) {
    return (
      <AuthFrame
        kicker="Nothing to show yet"
        title="This workspace is empty"
        lede="Demo mode is on, so no sign-in is needed — but there is no seeded workspace to open. Run the seed and the consoles will fill up."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
          <pre
            style={{
              margin: 0,
              padding: "14px 16px",
              background: "var(--color-bg)",
              border: "1px solid var(--color-neutral-400)",
              fontSize: 12.5,
              lineHeight: 1.7,
            }}
          >
            npm run db:migrate{"\n"}
            npm run db:seed{"\n"}
            npm run db:conversations{"\n"}
            npm run db:rescore
          </pre>
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
