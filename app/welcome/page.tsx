import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { SignOutLink } from "@/components/SignOutLink";
import { WelcomeForm } from "@/components/WelcomeForm";
import { needsBusiness, startBusiness } from "@/lib/actions/welcome";
import { DEMO_MODE } from "@/lib/auth/mode";
import { getTenantSession } from "@/lib/auth/session";
import { INDUSTRIES } from "@/lib/business/industries";

export const metadata = { title: "Set up your business" };

/** Reading a website and embedding it takes longer than a normal request. */
export const maxDuration = 180;

/**
 * Where someone who has just signed up lands: one form, and they have a
 * business with a working assistant. Anyone who already belongs to a business
 * — or whose email has an invitation waiting, which signing in claims — goes
 * to the console instead.
 */
export default async function WelcomePage() {
  if (DEMO_MODE) redirect("/app");
  const { userId } = await auth();
  if (!userId) redirect("/sign-up");
  // Claims a waiting invitation for this email, if there is one.
  if (await getTenantSession()) redirect("/app");
  if (!(await needsBusiness(userId))) redirect("/app");

  const user = await currentUser();
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

  return (
    <AuthFrame
      kicker="Two minutes"
      title="Set up your business"
      lede="Tell Corva what you do. It builds your assistant from that, and you can talk to it straight away — on a 14-day free pilot."
    >
      <WelcomeForm
        industries={INDUSTRIES.map((i) => ({ key: i.key, label: i.label }))}
        defaultName={name}
        onStart={startBusiness}
      />
      <p style={{ marginTop: 22, fontSize: 12.5, color: "var(--color-neutral-700)" }}>
        Joining a business that already uses Corva? Ask them to invite {user?.primaryEmailAddress?.emailAddress ?? "your email"} from People &amp; roles.{" "}
        <SignOutLink />
      </p>
    </AuthFrame>
  );
}
