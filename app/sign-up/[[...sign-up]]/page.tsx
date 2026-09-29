import { SignUp } from "@clerk/nextjs";
import { DEMO_MODE } from "@/lib/auth/mode";
import { AuthFrame } from "@/components/AuthFrame";

export const metadata = { title: "Create an account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ email_address?: string }>;
}) {
  // An invite link carries the invited address, so the one that will be
  // claimed is the one already in the box.
  const { email_address } = await searchParams;
  return (
    <AuthFrame
      kicker="Get started"
      title="Create your account"
      lede="Use the email your invitation was sent to — that is how Corva knows which business you belong to."
    >
      {DEMO_MODE ? (
        <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--color-neutral-800)", maxWidth: "38ch" }}>
          Demo mode is on, so there is nothing to sign in to — the consoles are
          open. Set <code>CORVA_DEMO=0</code> in <code>.env.local</code> to turn
          authentication back on.
        </p>
      ) : (
        <SignUp fallbackRedirectUrl="/app" initialValues={email_address ? { emailAddress: email_address } : undefined} />
      )}
    </AuthFrame>
  );
}
