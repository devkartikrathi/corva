import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEMO_MODE, OPERATOR_OPEN } from "@/lib/auth/mode";
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
    staffEmails: Boolean(process.env.CORVA_STAFF_EMAILS?.trim()),
    email: Boolean(process.env.RESEND_API_KEY),
    emailFromVerifiedDomain: Boolean(process.env.EMAIL_FROM),
    voiceTokenSecret: Boolean(process.env.VOICE_TOKEN_SECRET),
    voiceAvailable: voice.available,
    appUrlSet: Boolean(process.env.APP_URL),
  };
  const required = ["database", "pgvector", "gemini", "clerk", "staffEmails"] as const;
  return Response.json({
    ok: required.every((k) => checks[k]) && !DEMO_MODE,
    mode: { demo: DEMO_MODE, operatorOpen: OPERATOR_OPEN },
    appUrl: APP_URL,
    voiceUrl: voice.url,
    checks,
    missing: required.filter((k) => !checks[k]),
  });
}
