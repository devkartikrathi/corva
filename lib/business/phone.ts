import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import * as s from "@/lib/db/schema";

/**
 * Phone numbers, as the thing that decides which business answers.
 *
 * A call arrives *at a number*, so the number is the routing key — not a brand
 * picked from a dropdown. Every comparison is made on digits only, so
 * "+91 80 4719 2231", "08047192231" and "918047192231" are the same line.
 */

/** Canonical digits with the country code, e.g. "918047192231". */
export function phoneDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  // A national number written with the trunk zero: 080 4719 2231.
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d;
}

/** "+91 80 4719 2231" for landlines, "+91 98765 43210" for mobiles. */
export function formatPhone(input: string): string {
  const d = phoneDigits(input);
  if (d.length === 12 && d.startsWith("91")) {
    const n = d.slice(2);
    return /^[6-9]/.test(n)
      ? `+91 ${n.slice(0, 5)} ${n.slice(5)}`
      : `+91 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
  }
  return d ? `+${d}` : input.trim();
}

export function isPlausiblePhone(input: string): boolean {
  const d = phoneDigits(input);
  return d.length >= 11 && d.length <= 15;
}

const digitsOf = sql`regexp_replace(${s.channels.address}, '\\D', '', 'g')`;

/** The business a number belongs to, or null. */
export async function brandForNumber(number: string) {
  const digits = phoneDigits(number);
  if (!digits) return null;
  const [row] = await db
    .select({ brand: s.brands, channel: s.channels })
    .from(s.channels)
    .innerJoin(s.brands, eq(s.brands.id, s.channels.brandId))
    .where(and(eq(s.channels.kind, "phone"), sql`${digitsOf} = ${digits}`))
    .limit(1);
  return row ?? null;
}

/**
 * Whether a number is already another business's line.
 *
 * Two businesses on one number would make routing a coin toss, so it is
 * refused where numbers are assigned rather than discovered on the first call.
 */
export async function numberTaken(number: string, exceptBrandId?: string): Promise<string | null> {
  const found = await brandForNumber(number);
  if (!found || found.brand.id === exceptBrandId) return null;
  return found.brand.name;
}

/**
 * A free test number: a Hyderabad-style landline, +91 40 7xxx xxxx.
 *
 * The 40 7 range is not one anybody will mistake for their own number in a
 * demo, and a landline shape reads as "the business's line" rather than a
 * person's mobile.
 */
export async function freeTestNumber(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = `+91 40 7${String(Math.floor(Math.random() * 1000)).padStart(3, "0")} ${String(
      Math.floor(Math.random() * 10000),
    ).padStart(4, "0")}`;
    if (!(await brandForNumber(candidate))) return candidate;
  }
  throw new Error("Could not find a free test number. Try again.");
}
