import { handle } from "@/lib/integrations/api";
import { intakeLead, type LeadInput } from "@/lib/integrations/intake";
import { listLeads } from "@/lib/integrations/read";

/**
 * POST /api/v1/leads — a booking, callback or enquiry from the business's site.
 *
 * Creates or finds the customer by phone, opens or updates their lead, puts a
 * follow-up on someone's list and emails a confirmation. Returns the
 * reference, who owns it and when they will get back to the customer.
 */
export const POST = handle<LeadInput>((brand, body) => intakeLead(brand, body));

/**
 * GET /api/v1/leads — the business's leads, newest-changed first.
 *
 * Filter by stage, date, phone, reference, free text, or any of the business's
 * own Details to collect (`?details.request_type=Curtains`).
 */
export const GET = handle<unknown>((brand, _body, req) => listLeads(brand, new URL(req.url).searchParams));
