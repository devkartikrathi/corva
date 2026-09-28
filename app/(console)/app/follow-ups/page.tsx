import Link from "next/link";
import { ScreenHeader, ScreenRefusal, Th } from "@/components/ui";
import { ActionSelect, AddFollowUpForm, FollowUpButtons } from "@/components/CrmControls";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { customerScope } from "@/lib/auth/scope";
import {
  addFollowUp,
  assignFollowUp,
  completeFollowUp,
  postponeFollowUp,
  reopenFollowUp,
} from "@/lib/actions/crm";
import {
  assignableMembers,
  followUpCounts,
  listFollowUps,
  type FollowUpWindow,
} from "@/lib/queries/crm";

/**
 * Follow-ups.
 *
 * Every "we'll call you back" the business made — most of them by the AI, on
 * a call, with a person and a time attached. The list opens on what is late,
 * because a callback that did not happen is the complaint of tomorrow.
 */

const WINDOWS: { key: FollowUpWindow; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Done" },
];

const when = (d: Date) =>
  d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { session, brand, denied } = await guardScreen("calls.handle");
  if (denied) {
    return <ScreenRefusal title="Follow-ups" reason={refusalReason(denied)} next="Customer records show what was promised." />;
  }
  const { show } = await searchParams;

  const scope = customerScope(session.actor, session.membershipId, brand.id);
  const managesAll = scope.kind === "all";
  const counts = await followUpCounts(brand.id, scope);
  // Open on what is late, or today, whichever has anything in it.
  const window: FollowUpWindow = WINDOWS.some((w) => w.key === show)
    ? (show as FollowUpWindow)
    : counts.overdue > 0
      ? "overdue"
      : counts.today > 0
        ? "today"
        : "upcoming";

  const [rows, members] = await Promise.all([listFollowUps(brand.id, scope, { window }), assignableMembers(session.orgId)]);
  const memberOptions = members.map((m) => ({ value: m.id, label: m.name }));

  return (
    <section>
      <ScreenHeader
        kicker={brand.name}
        title={managesAll ? "Follow-ups" : "My follow-ups"}
        lede="Callbacks and promises, with a person and a time on each. The AI adds one whenever it tells a caller someone will get back to them."
      >
        <AddFollowUpForm
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          canAssign={managesAll}
          onAdd={async (input) => {
            "use server";
            await addFollowUp(input);
          }}
        />
      </ScreenHeader>

      <div style={{ display: "flex", gap: 0, borderBottom: "2px solid var(--color-divider)", padding: "0 24px" }}>
        {WINDOWS.map((w) => {
          const active = w.key === window;
          const n = counts[w.key];
          return (
            <Link
              key={w.key}
              href={`/app/follow-ups?show=${w.key}`}
              style={{
                padding: "11px 14px",
                fontSize: 12.5,
                fontWeight: active ? 800 : 600,
                color: w.key === "overdue" && n > 0 ? "var(--color-accent-700)" : "var(--color-text)",
                borderBottom: active ? "3px solid var(--color-accent)" : "3px solid transparent",
                marginBottom: -2,
              }}
            >
              {w.label} <span style={{ fontWeight: 600, color: "var(--color-neutral-700)" }}>{n}</span>
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p style={{ padding: "24px", margin: 0, fontSize: 13, color: "var(--color-neutral-800)" }}>
          {window === "overdue"
            ? "Nothing overdue."
            : window === "today"
              ? "Nothing due today."
              : window === "upcoming"
                ? "Nothing scheduled. When the AI promises a caller a callback, it appears here."
                : "Nothing completed yet."}
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--color-neutral-400)" }}>
              <Th padding="9px 24px">What</Th>
              <Th width={200}>Who for</Th>
              <Th width={170}>{window === "done" ? "Done" : "Due"}</Th>
              <Th width={170}>Assigned to</Th>
              <Th width={240} padding="9px 24px 9px 10px">
                {" "}
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id} style={{ borderBottom: "1px solid var(--color-neutral-300)", verticalAlign: "top" }}>
                <td style={{ padding: "12px 24px" }}>
                  <b>{f.title}</b>
                  {f.detail && <div style={{ marginTop: 3, fontSize: 11.5, color: "var(--color-neutral-800)" }}>{f.detail}</div>}
                  <div style={{ marginTop: 4, fontSize: 11, color: "var(--color-neutral-700)" }}>
                    {f.createdByAi ? (
                      <>
                        <span style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>AI</span> promised this
                      </>
                    ) : (
                      <>Added by {f.createdByName ?? "someone"}</>
                    )}
                    {f.conversationId && (
                      <>
                        {" · "}
                        <Link href={`/app/conversations?id=${f.conversationId}`} style={{ color: "var(--color-neutral-800)", textDecoration: "underline" }}>
                          the conversation
                        </Link>
                      </>
                    )}
                    {f.outcome && <> · &ldquo;{f.outcome}&rdquo;</>}
                  </div>
                </td>
                <td style={{ padding: "12px 10px" }}>
                  {f.customerId ? (
                    <Link href={`/app/customers/${f.customerId}`} style={{ color: "var(--color-text)", fontWeight: 600 }}>
                      {f.customerName ?? f.leadName ?? "Customer"}
                    </Link>
                  ) : (
                    <span>{f.leadName ?? "—"}</span>
                  )}
                  {f.customerPhone && <div style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{f.customerPhone}</div>}
                  {f.leadInterest && <div style={{ fontSize: 11, color: "var(--color-neutral-700)" }}>{f.leadInterest}</div>}
                </td>
                <td style={{ padding: "12px 10px", fontWeight: 600, color: f.overdue ? "var(--color-accent-700)" : undefined }}>
                  {window === "done" ? (f.completedAt ? when(f.completedAt) : "—") : when(f.dueAt)}
                  {window === "done" && f.completedByName && (
                    <div style={{ fontSize: 11, fontWeight: 400, color: "var(--color-neutral-700)" }}>by {f.completedByName}</div>
                  )}
                </td>
                <td style={{ padding: "12px 10px" }}>
                  {managesAll && f.status === "open" ? (
                    <ActionSelect
                      label="Assigned to"
                      value={f.assigneeMembershipId ?? ""}
                      options={memberOptions}
                      onChange={async (id) => {
                        "use server";
                        await assignFollowUp(f.id, id);
                      }}
                    />
                  ) : (
                    <span>{f.assigneeName ?? "Unassigned"}</span>
                  )}
                </td>
                <td style={{ padding: "12px 24px 12px 10px", textAlign: "right" }}>
                  <FollowUpButtons
                    open={f.status === "open"}
                    onDone={async (outcome) => {
                      "use server";
                      await completeFollowUp(f.id, outcome);
                    }}
                    onPostpone={async () => {
                      "use server";
                      await postponeFollowUp(f.id, 1);
                    }}
                    onReopen={async () => {
                      "use server";
                      await reopenFollowUp(f.id);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
