import { Kicker, OutlineButton, ScreenHeader, ScreenRefusal, SectionTitle, Tag, Th } from "@/components/ui";
import { ActionButton } from "@/components/ActionButton";
import { InvitePanel, RoleSelect } from "@/components/TeamControls";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { getTeam } from "@/lib/queries/workspace";
import { changeRole, inviteMember, revokeInvite, suspendMember } from "@/lib/actions/team";
import { can, CAPABILITIES, MATRIX, ROLES, grantLabel, grantWeight } from "@/lib/auth/permissions";

/** How each capability reads on the matrix. */
const CAPABILITY_LABELS: Record<string, string> = {
  "customers.read": "See customer records",
  "calls.handle": "Take and end live calls",
  "actions.approve_above_ceiling": "Approve above-ceiling actions",
  "agent.edit": "Edit AI persona & guardrails",
  "documents.publish": "Publish knowledge documents",
  "scoring.edit": "Change scoring weights & rules",
  "transcripts.export": "Export transcripts",
  "people.manage": "Manage people & roles",
  "billing.manage": "Billing, plan & residency",
  "team.performance": "See how colleagues are performing",
};

const WEIGHT_COLOR = {
  yes: "var(--color-text)",
  partial: "var(--color-accent-700)",
  no: "var(--color-neutral-400)",
} as const;

export default async function TeamPage() {
  const { session, brand, denied } = await guardScreen("people.manage");
  // The nav withholds this screen; this is what makes withholding it true.
  if (denied) {
    return (
      <ScreenRefusal
        title="Team & roles"
        reason={refusalReason(denied)}
        next="Who holds which account shows on the customer list."
      />
    );
  }

  const { people, brands, brandAccess, activity: recentActivity } = await getTeam(session.orgId);

  const manages = can(session.actor, "people.manage", { brandId: brand.id }).allowed;
  // Nobody hands out a role above their own; the server enforces this too, and
  // trimming the list here just stops the screen offering a refusal.
  const assignable = ROLES.slice(ROLES.indexOf(session.role));
  const activeOwners = people.filter((p) => p.roleKey === "owner" && p.statusKey === "active").length;

  // The matrix renders from the same rules the server enforces, so the screen
  // cannot drift from what is actually permitted.
  const matrix = CAPABILITIES.map((cap) => ({
    cap: CAPABILITY_LABELS[cap] ?? cap,
    cells: ROLES.map((role) => grantLabel(cap, MATRIX[cap][role])),
    c: ROLES.map((role) => WEIGHT_COLOR[grantWeight(MATRIX[cap][role])]),
  }));

  return (
    <section style={{ position: "relative" }}>
      <ScreenHeader
        kicker={`${session.orgName} · ${people.length} people`}
        title="Team & roles"
      >
        <OutlineButton href="/app/setup#audit">Audit log</OutlineButton>
        {manages && (
          <InvitePanel
            roles={[...assignable]}
            brands={brands}
            onInvite={async (input) => {
              "use server";
              await inviteMember({
                email: input.email,
                name: input.name,
                role: input.role as (typeof ROLES)[number],
                brandIds: input.brandIds,
                allBrands: input.allBrands,
              });
            }}
          />
        )}
      </ScreenHeader>

      {manages && (
        <p
          style={{
            padding: "0 24px 16px",
            margin: 0,
            fontSize: 12,
            color: "var(--color-neutral-700)",
            maxWidth: "78ch",
            lineHeight: 1.5,
          }}
        >
          As {session.role[0].toUpperCase() + session.role.slice(1)} you can invite people as{" "}
          <b style={{ color: "var(--color-text)" }}>
            {assignable.map((r) => r[0].toUpperCase() + r.slice(1)).join(", ")}
          </b>
          . Nobody can grant a role above their own, which is what stops an invite chain being
          walked upwards — Corva creates your Owner, and everyone else is invited from inside.
        </p>
      )}

      {/* Capability matrix */}
      <div style={{ padding: "18px 24px", borderBottom: "2px solid var(--color-divider)" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <SectionTitle size={16}>What each role can do</SectionTitle>
          <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>
            Roles are scoped to a brand — an agent on Aurelius Home never sees Northmoor&rsquo;s
            customers
          </span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14, fontSize: 12.5 }}>
          <thead>
            <tr
              style={{
                borderTop: "2px solid var(--color-divider)",
                borderBottom: "2px solid var(--color-divider)",
              }}
            >
              <Th padding="9px 0">Capability</Th>
              {ROLES.map((r) => (
                <Th key={r} width={120} padding="9px 12px">
                  {r[0].toUpperCase() + r.slice(1)}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((m) => (
              <tr key={m.cap} style={{ borderBottom: "1px solid var(--color-neutral-300)" }}>
                <td style={{ padding: "9px 0", color: "var(--color-text)" }}>{m.cap}</td>
                {m.cells.map((cell, i) => (
                  <td
                    key={ROLES[i]}
                    style={{ padding: "9px 12px", color: m.c[i], fontWeight: 600 }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px" }}>
        {/* People */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                <Th padding="9px 24px">Person</Th>
                <Th width={104} padding="9px 10px">Role</Th>
                <Th width={160} padding="9px 10px">Brands</Th>
                <Th width={96} padding="9px 10px">Status</Th>
                <Th width={92} padding="9px 10px">Last active</Th>
                {manages && <Th width={130} padding="9px 24px">Manage</Th>}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr
                  key={p.id}
                  className="hov-surface"
                  style={{ borderBottom: "1px solid var(--color-neutral-300)" }}
                >
                  <td style={{ padding: "10px 24px" }}>
                    <b style={{ fontSize: 13 }}>{p.name}</b>
                    <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                      {p.email}
                    </span>
                  </td>
                  <td style={{ padding: "10px 10px" }}>
                    <RoleSelect
                      membershipId={p.membershipId}
                      role={p.roleKey}
                      roles={[...assignable]}
                      // The only Owner cannot be demoted: there would be no one
                      // left who could undo it.
                      disabled={
                        !manages || (p.roleKey === "owner" && activeOwners <= 1)
                      }
                      onChange={async (membershipId, role) => {
                        "use server";
                        await changeRole(membershipId, role as (typeof ROLES)[number]);
                      }}
                    />
                  </td>
                  <td style={{ padding: "10px 10px", color: "var(--color-neutral-800)" }}>{p.brands}</td>
                  <td style={{ padding: "10px 10px" }}>
                    <Tag bg={p.tagBg} fg={p.tagFg} padding="3px 6px">
                      {p.status}
                    </Tag>
                  </td>
                  <td style={{ padding: "10px 10px", color: "var(--color-neutral-700)" }}>{p.active}</td>
                  {manages && (
                    <td style={{ padding: "10px 24px" }}>
                      {p.statusKey === "invited" ? (
                        <ActionButton
                          variant="hairline"
                          pendingLabel="Revoking…"
                          confirm={`Revoke the invite for ${p.email}?`}
                          style={{ fontSize: 10.5, padding: "3px 7px" }}
                          action={async () => {
                            "use server";
                            await revokeInvite(p.membershipId);
                          }}
                        >
                          Revoke invite
                        </ActionButton>
                      ) : p.membershipId === session.membershipId ? (
                        <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>you</span>
                      ) : (
                        <ActionButton
                          variant="hairline"
                          pendingLabel="Saving…"
                          confirm={
                            p.statusKey === "suspended"
                              ? undefined
                              : `Suspend ${p.name}? Their history stays; their access stops.`
                          }
                          style={{ fontSize: 10.5, padding: "3px 7px" }}
                          action={async () => {
                            "use server";
                            await suspendMember(p.membershipId, p.statusKey !== "suspended");
                          }}
                        >
                          {p.statusKey === "suspended" ? "Reinstate" : "Suspend"}
                        </ActionButton>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Right rail */}
        <div>
          <div style={{ padding: "16px 20px", borderBottom: "2px solid var(--color-divider)" }}>
            <Kicker>Brand access</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 12.5,
              }}
            >
              {brandAccess.map((b, i) => (
                <div
                  key={b.name}
                  style={{
                    display: "flex",
                    gap: 10,
                    paddingBottom: i < brandAccess.length - 1 ? 9 : undefined,
                    borderBottom:
                      i < brandAccess.length - 1 ? "1px solid var(--color-neutral-300)" : undefined,
                  }}
                >
                  <b style={{ flex: 1 }}>{b.name}</b>
                  <span style={{ color: "var(--color-neutral-700)" }}>{b.people}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <Kicker>Recent activity</Kicker>
            <div
              style={{
                marginTop: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
                fontSize: 12,
                color: "var(--color-neutral-800)",
              }}
            >
              {recentActivity.length === 0 && (
                <span style={{ color: "var(--color-neutral-700)" }}>
                  Nothing yet. Every consequential change lands here and in the audit log.
                </span>
              )}
              {recentActivity.map((a) => (
                <div key={a.id}>
                  <b style={{ color: "var(--color-text)" }}>{a.who}</b> {a.what}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
