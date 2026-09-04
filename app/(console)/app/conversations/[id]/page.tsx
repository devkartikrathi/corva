import { redirect } from "next/navigation";

/**
 * A permalink to one conversation.
 *
 * The archive is a list beside a detail pane, and the detail is selected by
 * `?id=`. Rather than build a second transcript view that would drift from
 * that one, this route redirects into it — so a link from search, from a
 * customer's timeline, or from an audit row lands on the same screen with the
 * list still beside it.
 */
export default async function ConversationPermalink({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/app/conversations?id=${encodeURIComponent(id)}`);
}
