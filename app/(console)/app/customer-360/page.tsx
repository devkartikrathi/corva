import { redirect } from "next/navigation";
import { getConsoleContext } from "@/lib/auth/context";
import { listCustomers } from "@/lib/queries/customers";

/**
 * The sidebar's Customer 360 entry.
 *
 * There is no single "the customer", so this resolves to whoever most needs
 * attention right now — the top of the priority queue — rather than pinning a
 * nav item to an id that may not exist in this workspace.
 */
export default async function Customer360Entry() {
  const { brand } = await getConsoleContext();
  const [top] = await listCustomers(brand.id, 1);

  redirect(top ? `/app/customers/${top.id}` : "/app/customers");
}
