/**
 * End-to-end smoke test of the golden path, without a browser.
 *
 *   1. add a business (clinic template, pasted facts, a two-person team)
 *   2. a new caller writes in on web chat and says who they are and what they want
 *   3. they ask for a callback
 *   4. check a lead, an owner and a follow-up came out of it
 *
 * Writes a real business called "Smoke Test Clinic …" — delete it from the
 * operator console afterwards, or leave it as demo data.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/smoke-business.ts
 */
import "../lib/db/script-env";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";
import { createBusiness } from "../lib/business/onboard";
import { brandForNumber } from "../lib/business/phone";
import { customerForCaller } from "../lib/crm/capture";
import { respond } from "../lib/agent/respond";

async function main() {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "");
  const result = await createBusiness(
    {
      businessName: `Smoke Test Clinic ${stamp}`,
      industry: "clinic",
      agentName: "Asha",
      website: "",
      about: [
        "Consultation: A consultation with the dentist costs ₹500.",
        "Cleaning: Teeth cleaning (scaling and polishing) costs ₹1,200 and takes 40 minutes.",
        "Doctors: Dr. Kavya Rao sees patients Monday to Friday; Dr. Iyer on Saturdays.",
      ].join("\n"),
      phoneNumber: "",
      ownerName: "Kavya Rao",
      ownerEmail: `kavya+${stamp}@smoketest.in`,
      team: `Ravi Kumar, ravi+${stamp}@smoketest.in, manager\nPooja Nair, pooja+${stamp}@smoketest.in, agent`,
    },
    { staffId: "smoke-test", name: "Smoke test" },
  );
  console.log("created", result.orgName, result.phoneNumber, result.documents, result.warnings);

  const found = await brandForNumber(result.phoneNumber);
  if (!found) throw new Error("the number does not route to the new business");
  console.log("number routes to", found.brand.name);

  const customer = await customerForCaller(found.brand.id, "+91 98765 12345");
  const [conversation] = await db
    .insert(s.conversations)
    .values({
      brandId: found.brand.id,
      customerId: customer?.id ?? null,
      channel: "web_chat",
      status: "live",
      isTest: true,
      startedAt: new Date(),
    })
    .returning();

  for (const message of [
    "Hi, I'm Arjun Mehta. How much is a teeth cleaning?",
    "Great. I'd like to get one done next week. Can someone call me back tomorrow at 11am to fix a slot?",
  ]) {
    const reply = await respond({ conversationId: conversation.id, message });
    console.log(`\ncustomer: ${message}\nai: ${reply.text}`);
    console.log("  actions:", reply.actions, reply.escalation ? `ESCALATED: ${reply.escalation.reason}` : "");
  }

  // Hang up, so the test does not sit on the live console forever.
  await db
    .update(s.conversations)
    .set({ status: "resolved", endedAt: new Date() })
    .where(eq(s.conversations.id, conversation.id));

  const leads = await db.select().from(s.leads).where(eq(s.leads.brandId, found.brand.id));
  const followUps = await db.select().from(s.followUps).where(eq(s.followUps.brandId, found.brand.id));
  const [cust] = await db.select().from(s.customers).where(eq(s.customers.id, customer!.id));
  console.log("\ncustomer now:", cust.name, cust.phone, "owner:", cust.owner);
  console.log("leads:", leads.map((l) => ({ name: l.name, interest: l.interest, stage: l.stage, owner: l.ownerMembershipId })));
  console.log("follow-ups:", followUps.map((f) => ({ title: f.title, due: f.dueAt.toISOString(), assignee: f.assigneeMembershipId })));

  const ok = leads.length > 0 && followUps.length > 0 && cust.name.includes("Arjun");
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
