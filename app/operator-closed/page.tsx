import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";

export const metadata = { title: "Corva admin" };

/**
 * Where a request for the operator console lands when it is closed.
 *
 * Corva's own console is for Corva staff: people whose email is on
 * `CORVA_STAFF_EMAILS`. Someone signed in with any other account lands here —
 * told plainly, rather than sent round the sign-in page again.
 */
export default function OperatorClosedPage() {
  return (
    <AuthFrame
      kicker="Corva admin"
      title="This console is for Corva staff"
      lede="You're signed in, but not as a member of Corva's team. If you run a business on Corva, your console is at /app."
    >
      <Link
        href="/app"
        className="hov-accent"
        style={{ display: "inline-block", fontSize: 13, fontWeight: 700, background: "var(--color-accent)", color: "var(--color-bg)", padding: "12px 18px" }}
      >
        Go to your console
      </Link>
    </AuthFrame>
  );
}
