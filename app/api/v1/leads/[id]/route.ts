import { handle } from "@/lib/integrations/api";
import { getLead, updateLead } from "@/lib/integrations/read";

const idOf = (req: Request) => decodeURIComponent(new URL(req.url).pathname.split("/").at(-1) ?? "");

/** GET /api/v1/leads/{id} — one lead, with its customer and follow-ups. */
export const GET = handle<unknown>((brand, _body, req) => getLead(brand, idOf(req)));

/**
 * POST /api/v1/leads/{id} — change a lead from the business's own system:
 * `{ stage?, lostReason?, notes?, valueRupees?, details? }`.
 */
export const POST = handle<Record<string, unknown>>((brand, body, req) => updateLead(brand, idOf(req), body));
