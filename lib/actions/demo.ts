"use server";

import { headers } from "next/headers";
import { saveDemoRequest } from "@/lib/demo-requests";

/**
 * Someone on the public site asking for a demo.
 *
 * The request is written down first and emailed second: it lands in /admin's
 * Demo requests whether or not email is set up, so nothing is lost on the day
 * the mail provider is down. The email goes to everyone in CORVA_ADMIN_EMAILS,
 * with the person's address as reply-to — answering it answers them.
 */

const WINDOW_MS = 60 * 60_000;
const MAX_PER_HOUR = 5;
const hits = new Map<string, number[]>();

export async function requestDemo(input: {
  name: string;
  email: string;
  phone: string;
  business: string;
  industry: string;
  website: string;
  message: string;
  /** A field people never see; only a script fills it in. */
  company_url?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  // Pretend it worked: a bot told "no" tries again differently.
  if (input.company_url) return { ok: true };

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (recent.length > MAX_PER_HOUR) return { ok: false, error: "That is a lot of requests — please try again in an hour." };

  return saveDemoRequest(input);
}
