import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { sameQuery, toQuery, type Params } from "@/lib/params";

/**
 * Saved views.
 *
 * A view is a stored copy of a screen's query string, so opening one and
 * hand-editing the address bar land in the same place. That is the whole
 * design: there is no privileged filtering path a saved view can use that a
 * URL cannot.
 */

export type SavedView = {
  id: string;
  name: string;
  query: Params;
  href: string;
  isDefault: boolean;
  shared: boolean;
};

export async function listSavedViews(
  orgId: string,
  surface: string,
  membershipId?: string,
): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(s.savedViews)
    .where(
      and(
        eq(s.savedViews.orgId, orgId),
        eq(s.savedViews.surface, surface),
        // Shared views (no membership) plus this person's own private ones.
        membershipId
          ? or(isNull(s.savedViews.membershipId), eq(s.savedViews.membershipId, membershipId))
          : isNull(s.savedViews.membershipId),
      ),
    )
    .orderBy(asc(s.savedViews.ordinal), asc(s.savedViews.name));

  const pathname = SURFACE_PATH[surface] ?? "/app";
  return rows.map((v) => {
    const query = (v.query ?? {}) as Params;
    return {
      id: v.id,
      name: v.name,
      query,
      href: `${pathname}${toQuery(query)}`,
      isDefault: v.isDefault,
      shared: v.membershipId === null,
    };
  });
}

const SURFACE_PATH: Record<string, string> = {
  customers: "/app/customers",
  conversations: "/app/conversations",
  fleet: "/operator",
};

/**
 * Which saved view the current query is showing, if any.
 *
 * Matched on the query rather than on an id in the URL, so arriving at the
 * same filter by hand still highlights the view that describes it — the tab
 * reflects what you are looking at, not how you got there.
 */
export function matchView(views: SavedView[], params: Params): SavedView | null {
  return views.find((v) => sameQuery(v.query, params)) ?? null;
}
