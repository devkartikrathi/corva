import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * One place that writes the audit log.
 *
 * The log is tenant-visible and is what makes the product's promises checkable
 * — "staff cannot read your transcripts without a grant" is only true if the
 * reads land here. So every action module calls this rather than inserting its
 * own shape, and the columns stay consistent enough to actually query.
 */
export async function audit(entry: {
  orgId: string;
  brandId?: string | null;
  actorType?: "user" | "staff" | "ai" | "system";
  actorId: string;
  actorName: string;
  action: string;
  target?: string | null;
  meta?: Record<string, unknown>;
}) {
  await db.insert(s.auditLog).values({
    orgId: entry.orgId,
    brandId: entry.brandId ?? null,
    actorType: entry.actorType ?? "user",
    actorId: entry.actorId,
    actorName: entry.actorName,
    action: entry.action,
    target: entry.target ?? null,
    meta: entry.meta ?? {},
  });
}
