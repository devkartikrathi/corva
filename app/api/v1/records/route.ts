import { handle } from "@/lib/integrations/api";
import { listRecords, upsertRecord, type RecordInput } from "@/lib/integrations/records";

/** GET /api/v1/records?reference= — the records Corva holds under a reference. */
export const GET = handle<unknown>((brand, _body, req) => listRecords(brand, new URL(req.url).searchParams));

/**
 * POST /api/v1/records — the current state of an order, booking or delivery in
 * the business's own system, so the assistant can tell a customer where it
 * has got to. Send it again on every change.
 */
export const POST = handle<RecordInput>((brand, body) => upsertRecord(brand, body));
