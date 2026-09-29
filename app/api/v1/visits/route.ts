import { handle } from "@/lib/integrations/api";
import { recordVisit, type VisitorInput } from "@/lib/integrations/intake";

/**
 * POST /api/v1/visits — a visitor on the site.
 *
 * Page detail (path, referrer, campaign) is only kept when `consent` is
 * "all"; with "necessary" Corva notes the visitor id and nothing else.
 */
export const POST = handle<VisitorInput>((brand, body) => recordVisit(brand, body));
