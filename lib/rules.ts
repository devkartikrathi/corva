/**
 * The vocabulary an override rule may use.
 *
 * A closed list rather than free text, because these names are looked up
 * against `RuleFacts` in the scoring engine — a typo would produce a rule that
 * silently never fires, which is the worst possible failure on a screen whose
 * whole promise is that every override is visible and attributed.
 *
 * Kept out of the actions module because a `"use server"` file may only export
 * async functions, and both the server action and the form need these.
 */

export const RULE_FIELDS = [
  { key: "tier", label: "Tier", kind: "text" },
  { key: "segment", label: "Segment", kind: "text" },
  { key: "ltv_pence", label: "Lifetime value (pence)", kind: "number" },
  { key: "days_since_contact", label: "Days since last contact", kind: "number" },
  { key: "contacts_30d", label: "Contacts in 30 days", kind: "number" },
  { key: "service_failures_90d", label: "Service failures in 90 days", kind: "number" },
  { key: "renewal_days", label: "Days to renewal", kind: "number" },
  { key: "intent", label: "Current intent", kind: "text" },
] as const;

export const RULE_OPS = ["eq", "contains", "gte", "lte", "gt", "lt"] as const;

export const RULE_ACTIONS = [
  { kind: "alert", label: "Alert a channel" },
  { kind: "assign_owner", label: "Assign an owner" },
  { kind: "force_human", label: "Always route to a person" },
  { kind: "create_task", label: "Create an outreach task" },
  { kind: "keep_with_ai", label: "Keep with the AI" },
] as const;

export type Clause = { field: string; op: string; value: string | number };

/** Reject a clause the scoring engine could not evaluate. */
export function validateClauses(clauses: Clause[]) {
  if (clauses.length === 0) throw new Error("A rule needs at least one condition.");
  for (const c of clauses) {
    if (!RULE_FIELDS.some((f) => f.key === c.field)) {
      throw new Error(`"${c.field}" is not a field a rule can test.`);
    }
    if (!RULE_OPS.includes(c.op as (typeof RULE_OPS)[number])) {
      throw new Error(`"${c.op}" is not a comparison a rule can make.`);
    }
    if (c.value === "" || c.value === null || c.value === undefined) {
      throw new Error("Every condition needs a value to compare against.");
    }
  }
}
