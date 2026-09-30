import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";

export const metadata = { title: "Corva admin" };

/**
 * Where a request for the operator console lands when it is closed.
 *
 * Reached from a local production build (`next start`) without
 * `CORVA_OPERATOR_OPEN=1`. On a deployment /operator does not exist at all.
 */
export default function OperatorClosedPage() {
  return (
    <AuthFrame
      kicker="Corva admin"
      title="This console runs on Corva's own machines"
      lede="Onboarding and test calls happen in the operator console, which runs locally for the Corva team. If you run a business on Corva, your console is at /app."
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
