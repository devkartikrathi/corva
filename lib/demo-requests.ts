import { eq } from "drizzle-orm";
import { adminEmails } from "@/lib/admin/auth";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";
import { APP_URL, layout, sendEmail } from "@/lib/email";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export type DemoRequestInput = {
  name: string;
  email: string;
  phone: string;
  business: string;
  industry: string;
  website: string;
  message: string;
};

/**
 * Write a demo request down, then tell Corva's admins.
 *
 * In that order: the row is what /admin lists, so a request survives the mail
 * provider being down or not set up yet.
 */
export async function saveDemoRequest(input: DemoRequestInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = clip(input.name, 80);
  const email = clip(input.email, 120).toLowerCase();
  if (name.length < 2) return { ok: false, error: "Please tell us your name." };
  if (!EMAIL.test(email)) return { ok: false, error: "That email address does not look right." };
  const phone = clip(input.phone, 30);
  const business = clip(input.business, 120);
  const industry = clip(input.industry, 60);
  const website = clip(input.website, 200);
  const message = clip(input.message, 2000);

  const [row] = await db
    .insert(s.demoRequests)
    .values({ name, email, phone: phone || null, business: business || null, industry: industry || null, website: website || null, message: message || null })
    .returning({ id: s.demoRequests.id });

  const mail = layout({
    heading: `Demo request: ${name}${business ? ` · ${business}` : ""}`,
    lines: [
      `${name} <${email}>${phone ? ` · ${phone}` : ""}`,
      [business && `Business: ${business}`, industry && `Kind: ${industry}`, website && `Website: ${website}`].filter(Boolean).join(" · ") || "No business details given.",
      message || "No message.",
    ],
    button: { label: "Open demo requests", href: `${APP_URL}/admin/demo-requests` },
    footer: "Reply to this email to answer them directly.",
  });
  const results = await Promise.all(
    adminEmails().map((to) => sendEmail({ to, subject: `Corva demo request — ${business || name}`, replyTo: email, fromName: "Corva", ...mail })),
  );
  if (results.some((r) => r.sent)) await db.update(s.demoRequests).set({ emailed: true }).where(eq(s.demoRequests.id, row.id));

  return { ok: true };
}
