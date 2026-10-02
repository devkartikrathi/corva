import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEMO_MODE } from "@/lib/auth/mode";
import { adminEmails } from "@/lib/admin/auth";
import { razorpayConfig, razorpayWebhookSecret } from "@/lib/billing/razorpay";
import { sealingReady } from "@/lib/data/crypto";
import { APP_URL } from "@/lib/email";
import { voiceBridge } from "@/lib/integrations/keys";

/**
 * GET /api/status — is this deployment configured?
 *
 * The first thing to open after setting environment variables. Every answer
 * is yes/no or a public address: no value of any secret is ever returned.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  let pgvector = false;
  try {
    await db.execute(sql`select 1`);
    database = true;
    const r = await db.execute(sql`select 1 from pg_extension where extname = 'vector'`);
    pgvector = (r as unknown as { rows?: unknown[] }).rows?.length ? true : Array.isArray(r) ? r.length > 0 : false;
  } catch {
    // reported as false below
  }
  const voice = voiceBridge();
  const checks = {
    database,
    pgvector,
    gemini: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY),
    clerk: Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY),
    clerkProductionKeys: (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "").startsWith("pk_live_"),
    email: Boolean(process.env.RESEND_API_KEY),
    emailFromVerifiedDomain: Boolean(process.env.EMAIL_FROM),
    voiceTokenSecret: Boolean(process.env.VOICE_TOKEN_SECRET),
    voiceAvailable: voice.available,
    appUrlSet: Boolean(process.env.APP_URL),
    // Who may open /admin, and where demo requests are emailed.
    adminEmailsSet: adminEmails().length > 0,
    // Plans can be paid for online; and Razorpay can tell us when a payment lands.
    payments: razorpayConfig().ok,
    paymentsWebhook: Boolean(razorpayWebhookSecret()),
    // Businesses can connect a database, an inbox and WhatsApp (their credentials are sealed with this).
    connectionsKey: sealingReady(),
    // Connected inboxes are read on a schedule.
    cronSecret: Boolean(process.env.CRON_SECRET),
  };
  const required = ["database", "pgvector", "gemini", "clerk"] as const;
  return Response.json({
    ok: required.every((k) => checks[k]) && !DEMO_MODE,
    mode: { demo: DEMO_MODE },
    appUrl: APP_URL,
    voiceUrl: voice.url,
    checks,
    missing: required.filter((k) => !checks[k]),
  });
}
