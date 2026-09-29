import { handle } from "@/lib/integrations/api";
import { intakeLead, type LeadInput } from "@/lib/integrations/intake";

/**
 * POST /api/v1/leads — a pickup, callback or enquiry from the business's site.
 *
 * Creates or finds the customer by phone, opens or updates their lead, puts a
 * follow-up on someone's list and emails a confirmation. Returns the
 * reference, who owns it and when they will get back to the customer.
 */
export const POST = handle<LeadInput>((brand, body) => intakeLead(brand, body));
