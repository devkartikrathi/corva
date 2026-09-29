import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";

export const metadata = { title: "Corva admin" };

/**
 * Where a request for the operator console lands when it is closed.
 *
 * For now Corva's own console is only open in development (see
 * `OPERATOR_OPEN`); staff sign-in comes later. Saying so is better than a
 * sign-in form that no account could get past.
 */
export default function OperatorClosedPage() {
  return (
    <AuthFrame
      kicker="Corva admin"
      title="Not available here"
      lede="Corva's own console is only open on development machines for now. If you run a business on Corva, your console is at /app."
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
