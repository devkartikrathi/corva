import { AuthFrame } from "@/components/AuthFrame";
import { DemoForm } from "@/components/DemoForm";
import { requestDemo } from "@/lib/actions/demo";
import { INDUSTRIES } from "@/lib/business/industries";

export const metadata = {
  title: "Book a demo — Corva",
  description: "See Corva answer for a business like yours: website chat and voice, leads, follow-ups and live takeover.",
};

/** The demo request form. Requests are emailed to Corva's admins and listed in /admin. */
export default function DemoPage() {
  return (
    <AuthFrame
      kicker="Book a demo"
      title="See it answer for a business like yours"
      lede="Tell us a little about your business. We will set up an assistant from your website and show you a customer's conversation becoming a lead your team can act on — about twenty minutes."
    >
      <DemoForm industries={INDUSTRIES.filter((i) => i.key !== "general").map((i) => i.label).concat("Something else")} onRequest={requestDemo} />
    </AuthFrame>
  );
}
