import { SignUp } from "@clerk/nextjs";
import { DEMO_MODE } from "@/lib/auth/mode";
import { AuthFrame } from "@/components/AuthFrame";

export const metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <AuthFrame
      kicker="Get started"
      title="Create your account"
      lede="You'll be placed in the workspace that invited you."
    >
      {DEMO_MODE ? (
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--color-neutral-800)", maxWidth: "38ch" }}>
          Demo mode is on, so there is nothing to sign in to — the consoles are
          open. Set <code>CORVA_DEMO=0</code> in <code>.env.local</code> to turn
          authentication back on.
        </p>
      ) : (
        <SignUp />
      )}
    </AuthFrame>
  );
}
