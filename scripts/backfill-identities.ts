/**
 * One customer, every channel: bring records made before handles were kept
 * up to date (docs/CUSTOMER-PROFILES.md). Safe to run again.
 *
 *   1. every phone and email on file becomes a handle (verified: it is on file)
 *   2. conversations with a customer say how they were identified
 *   3. conversations that collected a name or number but were never attached
 *      to a customer are identified now
 *   4. every customer's profile, segment and priority is computed
 *
 *   npx tsx scripts/backfill-identities.ts
 */
import "../lib/db/script-env";
import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";
import { handle, keepHandle } from "../lib/crm/identity";
import { identifyCustomer } from "../lib/crm/capture";
import { refreshBrandProfiles } from "../lib/crm/profile";

async function main() {
  const customers = await db.select().from(s.customers);
  let handles = 0;
  for (const c of customers) {
    for (const h of [handle("phone", c.phone), handle("email", c.email)]) {
      if (!h) continue;
      const kept = await keepHandle(c.id, c.brandId, h, { verified: true, source: c.segment === "Email" && h.kind === "email" ? "email" : "earlier" });
      if (kept.belongsTo) console.log(`  ${h.display} is on two records (${c.id}, ${kept.belongsTo}) — left for the team`);
      else handles++;
    }
  }
  console.log(`handles: ${handles} from ${customers.length} customers`);

  const marked = await db.execute(sql`
    UPDATE conversations SET identified_by = CASE
      WHEN channel = 'whatsapp' THEN 'whatsapp'
      WHEN channel = 'email' THEN 'email'
      WHEN channel = 'phone' AND coalesce(external_ref, '') NOT LIKE 'web-voice:%' THEN 'caller_id'
      ELSE 'stated' END
    WHERE customer_id IS NOT NULL AND identified_by IS NULL`);
  console.log(`conversations marked: ${marked.rowCount}`);

  const unattached = await db
    .select({ id: s.conversations.id, brandId: s.conversations.brandId, captured: s.conversations.captured })
    .from(s.conversations)
    .where(and(isNull(s.conversations.customerId), isNotNull(s.conversations.captured), sql`(captured ? 'phone' or captured ? 'name' or captured ? 'email')`));
  for (const c of unattached) {
    const got = c.captured as Record<string, string>;
    const who = await identifyCustomer({ conversationId: c.id, brandId: c.brandId, name: got.name, phone: got.phone, email: got.email });
    console.log(`  conversation ${c.id.slice(0, 8)} → ${who?.name ?? "nobody"}`);
  }

  for (const b of await db.select({ id: s.brands.id, name: s.brands.name }).from(s.brands)) {
    const n = await refreshBrandProfiles(b.id);
    if (n) console.log(`profiles: ${b.name} — ${n}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
