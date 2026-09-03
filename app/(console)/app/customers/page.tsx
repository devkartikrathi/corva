import Link from "next/link";
import {
  Bar,
  HairlineButton,
  Kicker,
  LinkAction,
  OutlineButton,
  PrimaryButton,
  ScreenTitle,
  Tag,
  Th,
} from "@/components/ui";
import { getConsoleContext } from "@/lib/auth/context";
import { axisFilters, behaviourFlags, customerViews } from "@/lib/data";
import { listCustomers } from "@/lib/queries/customers";

const SEGMENT_CHIPS = ["Trade", "Tier 1"];
const SEGMENT_OPTIONS = ["Retail", "Tier 2", "Subscription"];
const LAST_CONTACT = ["7d", "30d", "90d", "Any"];

export default async function AllCustomersPage() {
  const { brand } = await getConsoleContext();
  const customers = await listCustomers(brand.id);

  return (
    <section>
      <div style={{ padding: "24px 24px 0", display: "flex", alignItems: "flex-end", gap: 24 }}>
        <ScreenTitle kicker={`${brand.name} · ${customers.length} records`} title="All customers" />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <OutlineButton>Export CSV</OutlineButton>
          <PrimaryButton style={{ fontWeight: 600 }}>Save this view</PrimaryButton>
        </div>
      </div>

      {/* Saved views */}
      <div
        style={{
          marginTop: 18,
          padding: "0 24px",
          display: "flex",
          borderBottom: "2px solid var(--color-divider)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        {customerViews.map((v) =>
          v.current ? (
            <span
              key={v.label}
              style={{
                padding: "9px 14px",
                borderBottom: "3px solid var(--color-accent)",
                marginBottom: -2,
              }}
            >
              {v.label}
            </span>
          ) : (
            <button
              key={v.label}
              type="button"
              className="hov-ink"
              style={{ padding: "9px 14px", color: "var(--color-neutral-700)" }}
            >
              {v.label}
            </button>
          ),
        )}
        <button type="button" style={{ padding: "9px 12px", color: "var(--color-accent-700)" }}>
          + New
        </button>
      </div>

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
            <LinkAction size={11} style={{ marginLeft: "auto" }}>
              Reset
            </LinkAction>
          </div>

          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Score thresholds</Kicker>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
              {axisFilters.map((ax) => (
                <div key={ax.label}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ color: "var(--color-neutral-800)" }}>{ax.label}</span>
                    <b>{ax.readout}</b>
                  </div>
                  <Bar width={ax.bar} color={ax.color} marker="handle" />
                </div>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--color-neutral-300)" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Segment</Kicker>
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {SEGMENT_CHIPS.map((s) => (
                <span
                  key={s}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    background: "var(--color-text)",
                    color: "var(--color-bg)",
                    padding: "5px 9px",
                  }}
                >
                  {s} ×
                </span>
              ))}
              {SEGMENT_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="hov-border"
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    border: "1px solid var(--color-neutral-400)",
                    padding: "4px 9px",
                    color: "var(--color-neutral-700)",
                  }}
                >
                  {s}
                </button>
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
                fontSize: 12.5,
              }}
            >
              {behaviourFlags.map((f) => (
                <label
                  key={f.label}
                  style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer" }}
                >
                  <input type="checkbox" className="chk" defaultChecked={f.on} />
                  <span className="chk-box" />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          <div style={{ padding: "16px 18px" }}>
            <Kicker style={{ letterSpacing: "0.12em" }}>Last contact</Kicker>
            <div style={{ marginTop: 10, display: "flex", border: "1px solid var(--color-neutral-400)" }}>
              {LAST_CONTACT.map((r, i) =>
                i === 0 ? (
                  <span
                    key={r}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "7px 0",
                      fontSize: 11.5,
                      fontWeight: 700,
                      background: "var(--color-text)",
                      color: "var(--color-bg)",
                    }}
                  >
                    {r}
                  </span>
                ) : (
                  <button
                    key={r}
                    type="button"
                    className="hov-surface"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "7px 0",
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: "var(--color-neutral-700)",
                      borderLeft: "1px solid var(--color-neutral-400)",
                    }}
                  >
                    {r}
                  </button>
                ),
              )}
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
              Any filter combination can be saved as a view, shared with a role, or turned into an
              alert.
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
            <span style={{ fontWeight: 700 }}>{customers.length} customers</span>
            <span style={{ color: "var(--color-neutral-700)" }}>sorted by blended priority</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
              <HairlineButton>Columns</HairlineButton>
              <HairlineButton>Bulk assign</HairlineButton>
              <HairlineButton>Create alert</HairlineButton>
            </span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-divider)" }}>
                <Th padding="8px 24px">Customer</Th>
                <Th width={78} padding="8px 8px">Priority</Th>
                <Th width={84} padding="8px 8px">LTV</Th>
                <Th width={82} padding="8px 8px">Churn</Th>
                <Th width={82} padding="8px 8px">Sentiment</Th>
                <Th width={96} padding="8px 8px">Last contact</Th>
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

          <div
            style={{
              padding: "14px 24px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 12,
              color: "var(--color-neutral-700)",
              borderBottom: "2px solid var(--color-divider)",
            }}
          >
            <span>Showing 1–{customers.length} of {customers.length}</span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <HairlineButton style={{ padding: "5px 11px" }}>Previous</HairlineButton>
              <button
                type="button"
                className="hov-invert"
                style={{
                  border: "1px solid var(--color-text)",
                  padding: "5px 11px",
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                Next
              </button>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
