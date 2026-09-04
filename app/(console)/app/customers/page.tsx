import Link from "next/link";
import {
  Bar,
  Kicker,
  PrimaryButton,
  ScreenTitle,
  Tag,
  Th,
} from "@/components/ui";
import {
  ActiveFilters,
  CheckFilter,
  Chip,
  Pager,
  SearchBox,
  SortTh,
  Tab,
  TabStrip,
  ThresholdFilter,
} from "@/components/filters";
import { ExportCsvButton } from "@/components/ExportCsvButton";
import { SaveViewButton } from "@/components/SaveViewButton";
import { saveView } from "@/lib/actions/workspace";
import { getConsoleContext } from "@/lib/auth/context";
import { exportCustomersCsv } from "@/lib/actions/customers";
import { href, intOf, listOf, normalise, type RawParams } from "@/lib/params";
import { listCustomers } from "@/lib/queries/customers";
import { listSavedViews, matchView } from "@/lib/queries/views";

const PATH = "/app/customers";

/** The axes worth a threshold in the rail — the ones people actually filter on. */
const AXIS_FILTERS = [
  { key: "churn_risk", label: "Churn risk" },
  { key: "escalation_likelihood", label: "Escalation likelihood" },
  { key: "expansion_potential", label: "Expansion potential" },
];

const BEHAVIOUR_FLAGS = [
  { key: "on_call", label: "On a call right now" },
  { key: "churn", label: "Churn risk" },
  { key: "detractor", label: "Detractor" },
  { key: "payment", label: "Payment risk" },
  { key: "expansion", label: "Expansion candidate" },
  { key: "healthy", label: "Nothing flagged" },
];

const LAST_CONTACT = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "90", label: "90d" },
];

export default async function AllCustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const { session, brand } = await getConsoleContext();
  const params = normalise(await searchParams);
  const ctx = { pathname: PATH, params };

  // Axis thresholds ride in the URL as `axis_<key>=60`.
  const axisMinimums: Record<string, number> = {};
  for (const axis of AXIS_FILTERS) {
    const value = Number(params[`axis_${axis.key}`]);
    if (Number.isFinite(value) && value > 0) axisMinimums[axis.key] = value;
  }

  const [result, views] = await Promise.all([
    listCustomers(brand.id, {
      q: params.q,
      minScore: intOf(params, "minScore", 0, 0, 100) || undefined,
      axisMinimums,
      segment: listOf(params, "segment"),
      tier: listOf(params, "tier"),
      flag: listOf(params, "flag"),
      lastContact: params.lastContact,
      owner: params.owner,
      sort: params.sort,
      page: intOf(params, "page", 1, 1),
    }),
    listSavedViews(session.orgId, "customers", session.membershipId),
  ]);

  const customers = result.rows;
  const currentView = matchView(views, params);

  return (
    <section>
      <div style={{ padding: "24px 24px 0", display: "flex", alignItems: "flex-end", gap: 24 }}>
        <ScreenTitle
          kicker={`${brand.name} · ${result.total} record${result.total === 1 ? "" : "s"} matching`}
          title="All customers"
        />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <SearchBox ctx={ctx} placeholder="Name, reference, email, town" width={230} />
          <ExportCsvButton
            filename={`corva-customers-${brand.slug}.csv`}
            query={params}
            onExport={exportCustomersCsv}
          />
          <PrimaryButton href={href(PATH, params, { minScore: "70", sort: "score:desc" })} style={{ fontWeight: 600 }}>
            Needs attention
          </PrimaryButton>
        </div>
      </div>

      {/* Saved views */}
      <TabStrip style={{ marginTop: 18 }}>
        {views.map((v) => (
          <Tab key={v.id} label={v.name} href={v.href} current={currentView?.id === v.id} />
        ))}
        {!currentView && <Tab label="Custom" href={PATH} current />}
        <SaveViewButton surface="customers" query={params} onSave={saveView} />
      </TabStrip>

      <div style={{ display: "grid", gridTemplateColumns: "272px 1fr" }}>
        {/* Filter rail */}
        <div style={{ borderRight: "2px solid var(--color-divider)" }}>
          <div
            style={{
              padding: "14px 18px",
              borderBottom: "2px solid var(--color-divider)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
              }}
            >
              Filters
            </span>
            <span style={{ marginLeft: "auto" }}>
              <ActiveFilters ctx={ctx} ignore={["page", "sort"]} />
            </span>
          </div>

          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Score thresholds</Kicker>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              <ThresholdFilter ctx={ctx} paramKey="minScore" label="Blended priority" />
              {AXIS_FILTERS.map((ax) => (
                <ThresholdFilter
                  key={ax.key}
                  ctx={ctx}
                  paramKey={`axis_${ax.key}`}
                  label={ax.label}
                />
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Segment &amp; tier</Kicker>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {result.facets.segments.map((f) => (
                <Chip
                  key={f.value}
                  ctx={ctx}
                  paramKey="segment"
                  value={f.value}
                  label={`${f.value} ${f.count}`}
                  multi
                />
              ))}
              {result.facets.tiers.map((f) => (
                <Chip
                  key={f.value}
                  ctx={ctx}
                  paramKey="tier"
                  value={f.value}
                  label={`${f.value} ${f.count}`}
                  multi
                />
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Behaviour &amp; flags</Kicker>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {BEHAVIOUR_FLAGS.map((f) => (
                <CheckFilter key={f.key} ctx={ctx} paramKey="flag" value={f.key} label={f.label} />
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Owner</Kicker>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {result.facets.owners.map((f) => (
                <Chip
                  key={f.value}
                  ctx={ctx}
                  paramKey="owner"
                  value={f.value}
                  label={`${f.value} ${f.count}`}
                />
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 18px" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Last contact</Kicker>
            <div style={{ marginTop: 10, display: "flex", border: "1px solid var(--color-neutral-400)" }}>
              {[...LAST_CONTACT, { value: "", label: "Any" }].map((r, i) => {
                const on = (params.lastContact ?? "") === r.value;
                return (
                  <Link
                    key={r.label}
                    href={href(PATH, params, { lastContact: r.value || null })}
                    className={on ? undefined : "hov-surface"}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "7px 0",
                      fontSize: 11.5,
                      fontWeight: on ? 700 : 600,
                      background: on ? "var(--color-text)" : "transparent",
                      color: on ? "var(--color-bg)" : "var(--color-neutral-700)",
                      borderLeft: i === 0 ? undefined : "1px solid var(--color-neutral-400)",
                    }}
                  >
                    {r.label}
                  </Link>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 18,
                borderTop: "2px solid var(--color-divider)",
                paddingTop: 12,
                fontSize: 11.5,
                color: "var(--color-neutral-700)",
                lineHeight: 1.45,
              }}
            >
              Every filter is in the address bar, so this view can be linked, bookmarked, or saved
              as one of the tabs above.
            </div>
          </div>
        </div>

        {/* Table */}
        <div>
          <div
            style={{
              padding: "10px 24px",
              borderBottom: "1px solid var(--color-neutral-300)",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 12,
              background: "var(--color-surface)",
            }}
          >
            <span style={{ fontWeight: 700 }}>
              {result.total} customer{result.total === 1 ? "" : "s"}
            </span>
            <span style={{ color: "var(--color-neutral-700)" }}>
              {params.sort ? `sorted by ${params.sort.replace(":", " ")}` : "sorted by blended priority"}
            </span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                <SortTh ctx={ctx} field="name">Customer</SortTh>
                <SortTh ctx={ctx} field="score" width={78}>Priority</SortTh>
                <SortTh ctx={ctx} field="value" width={84}>LTV</SortTh>
                <SortTh ctx={ctx} field="churn" width={82}>Churn</SortTh>
                <Th width={82} padding="8px 8px">Sentiment</Th>
                <SortTh ctx={ctx} field="last" width={96}>Last contact</SortTh>
                <Th width={104} padding="8px 8px">Owner</Th>
                <Th width={118} padding="8px 24px">Flags</Th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr
                  key={c.id}
                  className="hov-surface"
                  style={{ borderBottom: "1px solid var(--color-neutral-300)" }}
                >
                  <td style={{ padding: "10px 24px" }}>
                    <Link href={`/app/customers/${c.id}`} style={{ textAlign: "left", color: "var(--color-text)" }}>
                      <b style={{ fontSize: 13 }}>{c.name}</b>
                      <span style={{ display: "block", fontSize: 11, color: "var(--color-neutral-700)" }}>
                        {c.meta}
                      </span>
                    </Link>
                  </td>
                  <td style={{ padding: "10px 8px" }}>
                    <b style={{ fontSize: 14, color: c.pColor }}>{c.priority}</b>
                  </td>
                  <td style={{ padding: "10px 8px", fontWeight: 600 }}>{c.ltv}</td>
                  <td style={{ padding: "10px 8px" }}>
                    <Bar width={c.churnBar} color={c.churnColor} />
                    <span style={{ fontSize: 10.5, color: "var(--color-neutral-700)" }}>{c.churn}</span>
                  </td>
                  <td style={{ padding: "10px 8px", color: c.sentColor, fontWeight: 600 }}>
                    {c.sentiment}
                  </td>
                  <td style={{ padding: "10px 8px", color: "var(--color-neutral-800)" }}>{c.last}</td>
                  <td style={{ padding: "10px 8px", color: "var(--color-neutral-800)" }}>{c.owner}</td>
                  <td style={{ padding: "10px 24px" }}>
                    <Tag bg={c.flagBg} fg={c.flagFg}>
                      {c.flag}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {customers.length === 0 && (
            <p style={{ padding: "28px 24px", fontSize: 12.5, color: "var(--color-neutral-700)" }}>
              No customer in {brand.name} matches these filters.{" "}
              <Link href={PATH} style={{ fontWeight: 700, color: "var(--color-accent-700)" }}>
                Clear them
              </Link>
              .
            </p>
          )}
          <Pager ctx={ctx} page={result.page} pageSize={result.pageSize} total={result.total} />

                  </div>
      </div>
    </section>
  );
}
