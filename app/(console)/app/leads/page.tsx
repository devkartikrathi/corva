import Link from "next/link";
import { ScreenHeader, ScreenRefusal } from "@/components/ui";
import { ActionSelect, AddLeadForm } from "@/components/CrmControls";
import { guardScreen, refusalReason } from "@/lib/auth/screen";
import { customerScope } from "@/lib/auth/scope";
import { assignLead, createLead, setLeadStage } from "@/lib/actions/crm";
import { industryFor, LEAD_STAGES } from "@/lib/business/industries";
import { intakeFieldsFor, labelled } from "@/lib/business/intake";
import { formatRupees, formatRupeesShort } from "@/lib/money";
import { assignableMembers, listLeads, pipeline, type LeadRow } from "@/lib/queries/crm";

/**
 * Leads.
 *
 * Everyone who rang wanting something, and where each one has got to. Most of
 * these were written by the AI during a call — marked as such — so this screen
 * is where the phone line turns into revenue: the team picks them up, moves
 * them along, and the owner can see what is stuck and with whom.
 */

function ago(date: Date) {
  const mins = Math.round((Date.now() - date.getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function due(date: Date) {
  const late = date.getTime() < Date.now();
  const label = date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return { label, late };
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { session, brand, denied } = await guardScreen("customers.read");
  if (denied) {
    return <ScreenRefusal title="Leads" reason={refusalReason(denied)} next="Leads appear on the home screen." />;
  }
  const { q } = await searchParams;

  const scope = customerScope(session.actor, session.membershipId, brand.id);
  const managesAll = scope.kind === "all";
  const industry = industryFor(brand.industry);

  const [leads, members, fields] = await Promise.all([
    listLeads(brand.id, scope, { q }),
    assignableMembers(session.orgId),
    intakeFieldsFor(brand.id, brand.industry),
  ]);
  // The business's own details on each card; name and phone are shown already.
  const cardFields = fields.filter((f) => !f.builtIn);
  const columns = pipeline(leads, industry.key);
  const open = columns.filter((c) => c.stage !== "won" && c.stage !== "lost");
  const openCount = open.reduce((n, c) => n + c.count, 0);
  const openValue = open.reduce((n, c) => n + c.valuePaise, 0);
  const won = columns.find((c) => c.stage === "won")!;
  const byAi = leads.filter((l) => l.createdByAi).length;

  const stageOptions = LEAD_STAGES.map((s) => ({ value: s, label: industry.stages[s] }));
  const memberOptions = members.map((m) => ({ value: m.id, label: m.name }));

  return (
    <section>
      <ScreenHeader
        kicker={`${brand.name} · ${industry.label}`}
        title={managesAll ? "Leads" : "My leads"}
        lede={`${openCount} open${openValue ? ` worth ${formatRupeesShort(openValue)}` : ""} · ${won.count} ${industry.stages.won.toLowerCase()} · ${byAi} captured by the AI`}
      >
        <form style={{ display: "flex" }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name, need, phone"
            style={{
              border: "1px solid var(--color-neutral-400)",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "inherit",
              width: 220,
              background: "var(--color-bg)",
              color: "var(--color-text)",
            }}
          />
        </form>
        <AddLeadForm
          members={members.map((m) => ({ id: m.id, name: m.name }))}
          canAssign={managesAll}
          onCreate={createLead}
        />
      </ScreenHeader>

      {leads.length === 0 ? (
        <div style={{ padding: "28px 24px", maxWidth: "62ch", fontSize: 13, lineHeight: 1.6, color: "var(--color-neutral-800)" }}>
          <b style={{ color: "var(--color-text)" }}>No leads {q ? "match that search" : "yet"}.</b>{" "}
          {!q &&
            `When someone new calls ${brand.name}, the AI takes their name and what they want and puts them here, with someone on the team as owner. You can also add one by hand.`}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`,
            overflowX: "auto",
            minHeight: 480,
          }}
        >
          {columns.map((col) => (
            <div
              key={col.stage}
              style={{
                borderRight: "1px solid var(--color-neutral-300)",
                background: col.stage === "won" || col.stage === "lost" ? "var(--color-surface)" : undefined,
              }}
            >
              <div
                style={{
                  padding: "12px 12px 10px",
                  borderBottom: "2px solid var(--color-divider)",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  position: "sticky",
                  top: 0,
                  background: "var(--color-bg)",
                }}
              >
                <b style={{ fontSize: 12.5 }}>{col.label}</b>
                <span style={{ fontSize: 11.5, color: "var(--color-neutral-700)" }}>{col.count}</span>
                {col.valuePaise > 0 && (
                  <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700 }}>{formatRupeesShort(col.valuePaise)}</span>
                )}
              </div>
              <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                {col.leads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    stageOptions={stageOptions}
                    memberOptions={memberOptions}
                    canAssign={managesAll}
                    details={labelled(cardFields, lead.details ?? {})}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LeadCard({
  lead,
  stageOptions,
  memberOptions,
  canAssign,
  details,
}: {
  details: { key: string; label: string; value: string }[];
  lead: LeadRow;
  stageOptions: { value: string; label: string }[];
  memberOptions: { value: string; label: string }[];
  canAssign: boolean;
}) {
  const next = lead.nextDue ? due(lead.nextDue) : null;
  return (
    <div style={{ border: "1px solid var(--color-neutral-400)", background: "var(--color-bg)", padding: "10px 11px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        {lead.customerId ? (
          <Link href={`/app/customers/${lead.customerId}`} style={{ color: "var(--color-text)", fontWeight: 700, fontSize: 13 }}>
            {lead.name}
          </Link>
        ) : (
          <b style={{ fontSize: 13 }}>{lead.name}</b>
        )}
        {lead.createdByAi && (
          <span
            title="Captured by the AI during a conversation"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", background: "var(--color-accent)", color: "var(--color-bg)", padding: "1px 5px" }}
          >
            AI
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--color-neutral-700)" }}>{ago(lead.createdAt)}</span>
      </div>
      {lead.interest && <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.45 }}>{lead.interest}</div>}
      {details.length > 0 && (
        <dl style={{ margin: "6px 0 0", fontSize: 11, lineHeight: 1.45, display: "grid", gridTemplateColumns: "auto 1fr", gap: "1px 8px" }}>
          {details.map((d) => (
            <div key={d.key} style={{ display: "contents" }}>
              <dt style={{ color: "var(--color-neutral-700)" }}>{d.label}</dt>
              <dd style={{ margin: 0, fontWeight: 600, wordBreak: "break-word" }}>{d.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-neutral-700)", display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
        {lead.phone && <span>{lead.phone}</span>}
        {lead.valuePaise ? <b style={{ color: "var(--color-text)" }}>{formatRupees(lead.valuePaise)}</b> : null}
        <span>{lead.source.replace("_", " ")}</span>
      </div>
      {next && (
        <div style={{ marginTop: 5, fontSize: 11, fontWeight: 600, color: next.late ? "var(--color-accent-700)" : "var(--color-neutral-800)" }}>
          {next.late ? "Overdue" : "Next"}: {next.label}
          {lead.openFollowUps > 1 ? ` (+${lead.openFollowUps - 1})` : ""}
        </div>
      )}
      {lead.stage === "lost" && lead.lostReason && (
        <div style={{ marginTop: 5, fontSize: 11, color: "var(--color-neutral-700)" }}>Lost: {lead.lostReason}</div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <ActionSelect
          label="Stage"
          value={lead.stage}
          options={stageOptions}
          onChange={async (stage) => {
            "use server";
            await setLeadStage(lead.id, stage);
          }}
        />
        {canAssign ? (
          <ActionSelect
            label="Owner"
            value={lead.ownerMembershipId ?? ""}
            options={memberOptions}
            onChange={async (id) => {
              "use server";
              await assignLead(lead.id, id);
            }}
          />
        ) : (
          <span style={{ fontSize: 11, color: "var(--color-neutral-700)", alignSelf: "center" }}>{lead.ownerName ?? "Unassigned"}</span>
        )}
      </div>
    </div>
  );
}
