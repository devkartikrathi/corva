/**
 * The role model, encoded from the capability matrix on the Team & roles
 * screen. That table is the specification: this file is the same table in a
 * form the server can enforce, and the screen renders itself from here rather
 * than from a second copy.
 */
import { formatRupees } from "@/lib/money";

export const ROLES = ["owner", "admin", "manager", "agent", "analyst"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  agent: "Agent",
  analyst: "Analyst",
};

/** Every gated capability in the product. */
export const CAPABILITIES = [
  "customers.read",
  "calls.handle",
  "actions.approve_above_ceiling",
  "agent.edit",
  "documents.publish",
  "scoring.edit",
  "transcripts.export",
  "people.manage",
  "billing.manage",
  "team.performance",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * How a role holds a capability.
 *
 *   full        — without qualification
 *   assigned    — only for brands the membership is scoped to
 *   read_only   — may see it, may not change it
 *   limited     — allowed up to a bound; see `approvalCeilingPaise`
 *   propose     — may draft a change, may not publish it
 *   draft       — may create, may not publish
 *   own_team    — only over people they manage
 *   none        — not at all
 */
export type Grant =
  | "full"
  | "assigned"
  | "read_only"
  | "limited"
  | "propose"
  | "draft"
  | "own_team"
  | "none";

/** The design's matrix, transcribed. Rows are capabilities, columns roles. */
export const MATRIX: Record<Capability, Record<Role, Grant>> = {
  "customers.read": { owner: "full", admin: "full", manager: "full", agent: "assigned", analyst: "read_only" },
  "calls.handle": { owner: "full", admin: "full", manager: "full", agent: "full", analyst: "none" },
  "actions.approve_above_ceiling": { owner: "full", admin: "none", manager: "limited", agent: "none", analyst: "none" },
  "agent.edit": { owner: "full", admin: "full", manager: "propose", agent: "none", analyst: "none" },
  "documents.publish": { owner: "full", admin: "full", manager: "full", agent: "draft", analyst: "none" },
  "scoring.edit": { owner: "full", admin: "full", manager: "none", agent: "none", analyst: "none" },
  "transcripts.export": { owner: "full", admin: "full", manager: "full", agent: "none", analyst: "full" },
  "people.manage": { owner: "full", admin: "full", manager: "own_team", agent: "none", analyst: "none" },
  "billing.manage": { owner: "full", admin: "none", manager: "none", agent: "none", analyst: "none" },
  /**
   * How well named colleagues are doing.
   *
   * A Manager's job, an Analyst's to report on, and nobody else's. An Agent is
   * deliberately `none` rather than read-only: a league table you are on is
   * not information, it is pressure, and it is not what this screen is for.
   */
  "team.performance": { owner: "full", admin: "full", manager: "full", agent: "none", analyst: "read_only" },
};

/** The words the Team screen prints for each grant, per capability. */
export const GRANT_LABELS: Partial<Record<Capability, Partial<Record<Grant, string>>>> = {
  "customers.read": { full: "Full", assigned: "Assigned brand", read_only: "Read-only" },
  "actions.approve_above_ceiling": { full: "Any", limited: "Up to ₹50,000", none: "No" },
  "agent.edit": { propose: "Propose only" },
  "documents.publish": { draft: "Draft only" },
  "people.manage": { own_team: "Own team" },
  "team.performance": { full: "Full", read_only: "Read-only", none: "No" },
};

const DEFAULT_LABELS: Record<Grant, string> = {
  full: "Yes",
  assigned: "Assigned brand",
  read_only: "Read-only",
  limited: "Limited",
  propose: "Propose only",
  draft: "Draft only",
  own_team: "Own team",
  none: "No",
};

export function grantLabel(capability: Capability, grant: Grant): string {
  return GRANT_LABELS[capability]?.[grant] ?? DEFAULT_LABELS[grant];
}

/** How emphatically the matrix cell should read: yes, partial, or no. */
export function grantWeight(grant: Grant): "yes" | "partial" | "no" {
  if (grant === "none") return "no";
  if (grant === "full") return "yes";
  return "partial";
}

/** What a Manager may sign off without an Owner: ₹50,000. */
export const MANAGER_APPROVAL_CEILING_PAISE = 50_00_000;

/* ─── The check ────────────────────────────────────────────────────────── */

export type Actor = {
  role: Role;
  /** Null when the membership covers every brand in the org. */
  brandIds: string[] | null;
};

export type CheckOptions = {
  /** Which brand the action touches, when it touches one. */
  brandId?: string;
  /** For approvals, the amount at stake. */
  amountPaise?: number;
  /** True when the caller intends to publish rather than draft. */
  publishing?: boolean;
};

export type Decision =
  | { allowed: true; grant: Grant }
  | { allowed: false; grant: Grant; reason: string };

/**
 * The single authorization entry point. Server code asks this; nothing infers
 * permission from the shape of the UI.
 */
export function can(actor: Actor, capability: Capability, options: CheckOptions = {}): Decision {
  const grant = MATRIX[capability][actor.role];

  if (grant === "none") {
    return { allowed: false, grant, reason: `${ROLE_LABELS[actor.role]} cannot ${capability}.` };
  }

  // A brand-scoped membership only reaches the brands it was given.
  if (options.brandId && actor.brandIds && !actor.brandIds.includes(options.brandId)) {
    return { allowed: false, grant, reason: "Out of brand scope." };
  }

  switch (grant) {
    case "read_only":
      return { allowed: false, grant, reason: "Read-only." };

    case "limited": {
      const amount = options.amountPaise ?? 0;
      if (amount > MANAGER_APPROVAL_CEILING_PAISE) {
        return {
          allowed: false,
          grant,
          reason: `Above the ${ROLE_LABELS[actor.role]} ceiling of ${formatRupees(MANAGER_APPROVAL_CEILING_PAISE)}.`,
        };
      }
      return { allowed: true, grant };
    }

    case "propose":
    case "draft":
      if (options.publishing) {
        return { allowed: false, grant, reason: "May draft, but not publish." };
      }
      return { allowed: true, grant };

    default:
      return { allowed: true, grant };
  }
}

/** Throwing variant, for server actions where a denial is a bug or an attack. */
export function assertCan(actor: Actor, capability: Capability, options: CheckOptions = {}): void {
  const decision = can(actor, capability, options);
  if (!decision.allowed) {
    throw new AuthorizationError(`${capability}: ${decision.reason}`);
  }
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
