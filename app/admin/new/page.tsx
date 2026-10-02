import { AddBusinessForm } from "@/components/AdminControls";
import { addBusiness } from "@/lib/actions/admin";
import { requireAdmin } from "@/lib/admin/auth";
import { INDUSTRIES } from "@/lib/business/industries";

/** Reading a website and embedding it takes longer than a normal request. */
export const maxDuration = 180;

/**
 * Setting a business up for someone — after a demo, say. Most businesses do
 * this themselves at /welcome; this is the same thing done on their behalf,
 * with the Owner seat sent to them as an invitation.
 */
export default async function AdminNewBusinessPage() {
  await requireAdmin();
  return (
    <section>
      <h1 style={{ margin: 0, fontWeight: 800, fontSize: 28, letterSpacing: "-0.025em" }}>Add a business</h1>
      <p style={{ margin: "8px 0 20px", color: "var(--color-neutral-800)", maxWidth: "70ch", lineHeight: 1.5 }}>
        Creates the business on a 14-day pilot with its assistant and knowledge, and emails the owner an invitation. They can also do all of
        this themselves by signing up.
      </p>
      <AddBusinessForm industries={INDUSTRIES.map((i) => ({ key: i.key, label: i.label }))} onAdd={addBusiness} />
    </section>
  );
}
