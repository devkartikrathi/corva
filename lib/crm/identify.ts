import { generateObject } from "ai";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { languageModel, thinkingOptions } from "@/lib/agent/model";
import { resolveModel } from "@/lib/agent/models";
import { recordModelCall } from "@/lib/agent/quota";
import { captureDetails, intakeFieldsFor } from "@/lib/business/intake";
import { identifyCustomer, isUnnamed, saveCallerDetails } from "./capture";

/**
 * Who a caller said they were, read from the transcript.
 *
 * On a call the model is asked to save the caller's details as it hears them,
 * and sometimes it simply does not: the caller gives a name and a number, the
 * conversation goes on, and the console shows "Unidentified". A guardrail that
 * depends on the model cooperating is not a guardrail, so at the moments that
 * matter — a person is being brought in, or the call has ended — the
 * transcript is read once more and whatever the caller plainly said about
 * themselves is written down.
 *
 * Does nothing when the conversation already has a named customer with a
 * number, or when the caller never spoke.
 */

const Said = z.object({
  name: z.string().describe("The caller's own name, exactly as they gave it; empty if they never said it"),
  phone: z.string().describe("A phone number the caller gave, digits as said; empty if none"),
  email: z.string().describe("An email address the caller gave; empty if none"),
  interest: z
    .string()
    .describe(
      "What they want from the business — a product, service or booking — in one line with specifics. " +
        "Empty if unclear, and empty if all they asked for was to speak to a person",
    ),
});

export async function identifyFromTranscript(conversationId: string) {
  const [row] = await db
    .select({ conversation: s.conversations, customer: s.customers, brand: s.brands })
    .from(s.conversations)
    .innerJoin(s.brands, eq(s.brands.id, s.conversations.brandId))
    .leftJoin(s.customers, eq(s.customers.id, s.conversations.customerId))
    .where(eq(s.conversations.id, conversationId))
    .limit(1);
  if (!row) return null;
  const { conversation, customer, brand } = row;
  if (customer && !isUnnamed(customer.name) && customer.phone) return null;

  const turns = await db
    .select({ speaker: s.turns.speaker, body: s.turns.body })
    .from(s.turns)
    .where(eq(s.turns.conversationId, conversationId))
    .orderBy(asc(s.turns.ordinal));
  if (!turns.some((t) => t.speaker === "customer")) return null;

  const model = resolveModel(brand.modelId);
  const { object: said, usage } = await generateObject({
    model: languageModel(model.id),
    providerOptions: thinkingOptions(model.thinking.turn),
    schema: Said,
    system:
      "You read a customer conversation and write down what the customer said about themselves. " +
      "Only what they actually said — never guess a name from an email, never complete a number, " +
      "and leave a field empty rather than invent it. Speech-to-text may spell a name oddly; keep it as written.",
    prompt: turns.map((t) => `${t.speaker}: ${t.body}`).join("\n"),
  });
  await recordModelCall(model.id, usage);

  const name = said.name.trim() || undefined;
  const phone = said.phone.trim() || undefined;
  const email = said.email.trim() || undefined;
  const interest = said.interest.trim() || undefined;
  if (!name && !phone && !email) return null;

  // With something they wanted, it is a lead as well as a customer — the same
  // row the model's own save would have written.
  const base = { conversationId, brandId: brand.id, customerId: conversation.customerId, name, phone, email };
  const found = interest
    ? (await saveCallerDetails({ ...base, interest, source: conversation.channel })).lead.customerId
    : (await identifyCustomer(base))?.id;

  const fields = await intakeFieldsFor(brand.id, brand.industry);
  await captureDetails(conversationId, fields, { ...(name ? { name } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}) });
  return { customerId: found ?? null, name, phone, email, interest };
}
