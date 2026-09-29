import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { AuthFrame } from "@/components/AuthFrame";
import { DEMO_MODE } from "@/lib/auth/mode";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { ROLE_LABELS } from "@/lib/auth/permissions";

/**
 * An invite.
 *
 * Reached from the link Corva staff hand a new Owner, or that an Owner hands a
 * colleague. It shows what is being offered — which company, which role, who
 * offered it — before asking anyone to sign in, because "click this link and
 * authenticate" with no context is how phishing looks.
 *
 * Accepting binds a Clerk identity to the waiting membership: sign up or in
 * with the invited address and the session layer does the rest
 * (`claimByEmail` in lib/auth/session.ts). In demo mode there is no account to
 * bind to, and the page says so plainly rather than pretending to work.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const [invite] = await db
    .select({ membership: s.memberships, org: s.organizations })
    .from(s.memberships)
    .innerJoin(s.organizations, eq(s.organizations.id, s.memberships.orgId))
    .where(eq(s.memberships.inviteToken, token))
    .limit(1);

  if (!invite || invite.membership.status !== "invited") {
    return (
      <AuthFrame
        kicker="Invitation"
        title="This link is no longer valid"
        lede="It may have been used already, or withdrawn. Ask whoever sent it to invite you again."
      >
        <Link
          href="/"
          className="hov-invert"
          style={{
            display: "inline-block",
            fontSize: 12,
            fontWeight: 600,
            border: "2px solid var(--color-text)",
            padding: "8px 14px",
            color: "var(--color-text)",
          }}
        >
          Back to Corva
        </Link>
      </AuthFrame>
    );
  }

  const { membership, org } = invite;

  // Accepting is signing in with the invited address — the session layer binds
  // the membership by verified email on the next console request.
  let signedInAs: string | null = null;
  if (!DEMO_MODE) {
    const { userId } = await auth();
    if (userId) {
      const user = await currentUser();
      signedInAs = user?.primaryEmailAddress?.emailAddress.toLowerCase() ?? null;
    }
  }
  const role = ROLE_LABELS[membership.role];
  // "a Admin" reads as a bug even though it is only an article.
  const article = /^[AEIOU]/.test(role) ? "an" : "a";

  return (
    <AuthFrame
      kicker={`Invitation from ${membership.invitedByName ?? org.name}`}
      title={`Join ${org.name} as ${role}`}
      lede={`${membership.email} has been invited to the ${org.name} workspace. Data for this company is held in ${org.region}.`}
    >
      <div
        style={{
          border: "1px solid var(--color-neutral-400)",
          background: "var(--color-surface)",
          padding: "14px 16px",
          fontSize: 12.5,
          lineHeight: 1.6,
          maxWidth: "52ch",
        }}
      >
        <b>
          What {article} {role} can do
        </b>
        <p style={{ margin: "6px 0 0", color: "var(--color-neutral-800)" }}>
          {membership.role === "owner"
            ? "Everything, including billing, residency and inviting the rest of the team."
            : membership.role === "admin"
              ? "Everything except billing — channels, documents, the agent and people."
              : membership.role === "manager"
                ? "Handle calls, approve above-ceiling actions up to ₹50,000, publish documents, propose agent changes, and invite your own team."
                : membership.role === "agent"
                  ? "Handle calls and handoffs, read the customers you are scoped to, and draft documents."
                  : "Read conversations, customers and analytics, and export transcripts. No live calls."}
        </p>
      </div>

      {!DEMO_MODE && signedInAs ? (
        signedInAs === membership.email.toLowerCase() ? (
          <Link
            href="/app"
            className="hov-accent"
            style={{
              display: "inline-block",
              marginTop: 18,
              fontSize: 12,
              fontWeight: 700,
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              padding: "10px 14px",
            }}
          >
            Open {org.name}
          </Link>
        ) : (
          <p style={{ marginTop: 18, fontSize: 12.5, color: "var(--color-neutral-800)", lineHeight: 1.6, maxWidth: "52ch" }}>
            You are signed in as <b>{signedInAs}</b>, but this invitation is for <b>{membership.email}</b>.
            Sign out and sign in with that address to accept it.
          </p>
        )
      ) : DEMO_MODE ? (
        <p style={{ marginTop: 18, fontSize: 12.5, color: "var(--color-neutral-800)", lineHeight: 1.6, maxWidth: "52ch" }}>
          This deployment is running without authentication (<code>CORVA_DEMO=1</code>), so there is
          no account to bind this invitation to. Set <code>CORVA_DEMO=0</code> and configure Clerk
          to accept invitations for real.
        </p>
      ) : (
        <div style={{ marginTop: 18, display: "flex", gap: 8 }}>
          <Link
            href={`/sign-up?redirect_url=${encodeURIComponent(`/invite/${token}`)}&email_address=${encodeURIComponent(membership.email)}`}
            className="hov-accent"
            style={{
              display: "inline-block",
              fontSize: 12,
              fontWeight: 700,
              background: "var(--color-accent)",
              color: "var(--color-bg)",
              padding: "10px 14px",
            }}
          >
            Create an account
          </Link>
          <Link
            href={`/sign-in?redirect_url=${encodeURIComponent(`/invite/${token}`)}`}
            className="hov-invert"
            style={{
              display: "inline-block",
              fontSize: 12,
              fontWeight: 600,
              border: "2px solid var(--color-text)",
              padding: "8px 14px",
              color: "var(--color-text)",
            }}
          >
            I already have one
          </Link>
        </div>
      )}
    </AuthFrame>
  );
}
