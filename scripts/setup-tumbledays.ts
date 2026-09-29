/**
 * Set up Tumble Days — Corva's first customer.
 *
 * A laundromat in Gurugram (SWASTIKA FABRIC CARE SERVICES LLP) whose site has
 * a chat assistant, Tumbly. This creates their business on Corva from the
 * laundry template, with Tumbly as the assistant's name and everything the
 * site's chat already knows as its knowledge (copied from the site's
 * `content.ts`, so the website and Corva say the same things), plus whatever
 * the live website adds.
 *
 * Idempotent: if Tumble Days already exists, it prints the details and stops.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/setup-tumbledays.ts owner@email.com "Owner Name"
 */
import "../lib/db/script-env";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as s from "../lib/db/schema";
import { createBusiness } from "../lib/business/onboard";

const ABOUT = `
Business: Tumble Days is a premium laundry and dry-cleaning service in Gurugram, operated by SWASTIKA FABRIC CARE SERVICES LLP. India's first truly green laundromat — American tumble technology, German fluid engineering, and Indian heart.

Service area: Gurugram only (Haryana, India). Free doorstep pickup and delivery, round the clock.

Services: Six services, one pickup — everything leaves the door together and comes back ready to wear.

Laundry: Wash, fold and ironing — professional washing, careful folding and crisp ironing for everyday garments.

Dry-cleaning: Premium dry-cleaning for delicate fabrics, formal wear and designer clothing.

Sofa and carpet cleaning: Deep cleaning that removes dust, stains and allergens from sofas and carpets.

Shoes and bags: Specialised cleaning and care for shoes, handbags and luxury accessories.

Curtains: Curtain dry-cleaning that removes dust, odours and stubborn stains.

Alterations: Quick and precise alterations and mini-tailoring for a better fit.

Current offer: Up to 50% off on the first order, with free pickup and delivery across Gurugram. Promo code FIRST50, valid on the first order only.

How it works: 1) Book a pickup — tell us what needs care; we collect from your doorstep, round the clock. 2) We clean it right — sorted by fabric, cleaned with skin-safe solvents, dried on sensors, not timers. 3) Delivered fresh — pressed, folded and returned to your door.

Fabric care: Commercial machines use precision tumble technology with controlled motion, reducing rubbing, twisting and fabric stress. Solvents are clinically certified and skin-safe, developed to German engineering standards. Detergents are dermatologically tested, residue-free and gentle on sensitive skin, safe for children and adults. Water is filtered and softened, and its temperature is matched to the fabric. Moisture sensors and low-heat drying stop exactly when garments are dry. Cleaning solutions are organic and pH-balanced and rinse out completely.

Prices and turnaround: Item-wise prices and exact turnaround times are not published. For pricing, the team calls the customer back.

Contact: Email Tumbledays.gurugram@gmail.com. Operations: 12A, SF, Reach 3Roads, Sector 70, Gurugram. Registered office: Shop No. 5, Ground Floor, The Sapphire Mall, Opp. Orchid Petals, Sector 49, Gurugram, Haryana 122018.
`.trim();

async function main() {
  const [ownerEmail, ownerName = "Tumble Days Owner"] = process.argv.slice(2);
  if (!ownerEmail) throw new Error('Pass the owner\'s email: scripts/setup-tumbledays.ts owner@email.com "Name"');

  const [existing] = await db.select().from(s.organizations).where(eq(s.organizations.slug, "tumble-days")).limit(1);
  if (existing) {
    const [brand] = await db.select().from(s.brands).where(eq(s.brands.orgId, existing.id)).limit(1);
    const [phone] = brand
      ? await db.select().from(s.channels).where(eq(s.channels.brandId, brand.id))
      : [];
    console.log(`Tumble Days already exists (${existing.slug}), brand ${brand?.id}, number ${phone?.address ?? "—"}.`);
    process.exit(0);
  }

  const result = await createBusiness(
    {
      businessName: "Tumble Days",
      industry: "laundry",
      agentName: "Tumbly",
      website: "https://tumbledays.com",
      about: ABOUT,
      phoneNumber: "",
      ownerName,
      ownerEmail,
      team: "",
    },
    { staffId: "setup-script", name: "Corva" },
  );
  console.log(`Created ${result.orgName}: ${result.phoneNumber}`);
  console.log("Knowledge:", result.documents);
  if (result.warnings.length) console.log("Warnings:", result.warnings);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
