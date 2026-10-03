"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { SMS_PURPOSES, SmsError, saveSmsSettings, saveSmsTemplate, sendSms, type SmsPurpose } from "@/lib/sms";
import { audit } from "./audit";

const friendly = async <T,>(work: () => Promise<T>) => {
  try {
    return await work();
  } catch (e) {
    if (e instanceof SmsError) throw new Error(e.message);
    throw e;
  }
};

export async function saveSmsSetup(input: { provider: string; enabled: boolean; senderId: string; dltEntityId: string; credentials: Record<string, string> | null }) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  await friendly(() => saveSmsSettings(brand.id, input, session.name));
  await audit({
    orgId: session.orgId,
    brandId: brand.id,
    actorId: session.membershipId,
    actorName: session.name,
    action: input.enabled ? "sms.enabled" : "sms.saved",
    target: input.provider,
    meta: { senderId: input.senderId, credentialsChanged: Boolean(input.credentials) },
  });
  revalidatePath("/app/setup");
}

export async function saveSmsTemplateAction(input: { purpose: string; body: string; dltTemplateId: string; providerTemplateId: string; enabled: boolean }) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  await friendly(() => saveSmsTemplate(brand.id, input));
  await audit({ orgId: session.orgId, brandId: brand.id, actorId: session.membershipId, actorName: session.name, action: "sms.template_saved", target: input.purpose });
  revalidatePath("/app/setup");
}

/** Send one template to a number, filled with sample values, to check the setup end to end. */
export async function sendTestSms(purpose: string, to: string) {
  const { session, brand } = await getConsoleContext();
  assertCan(session.actor, "people.manage", { brandId: brand.id });
  const p = SMS_PURPOSES.find((x) => x.key === purpose);
  if (!p) throw new Error("Unknown purpose.");
  const samples: Record<string, string> = {
    "customer's name": "Test",
    amount: "Rs 1",
    "what it is for": "a test",
    "payment link": "https://example.com/pay",
    "business name": brand.name,
    "what was booked": "test booking",
    when: "today 5 pm",
    reference: "TEST1",
    "who will call": "Our team",
    "what it is about": "your test",
    "WhatsApp link": "https://wa.me/910000000000",
    "order reference": "TEST1",
    "where it has got to": "ready",
  };
  const result = await sendSms({ brandId: brand.id, purpose: p.key as SmsPurpose, to, vars: p.slots.map((slot) => samples[slot] ?? "test"), sentByName: `${session.name} (test)` });
  revalidatePath("/app/setup");
  if (!result.sent) throw new Error(`Not sent: ${result.reason}.`);
  return { status: result.message.status, body: result.message.body };
}
