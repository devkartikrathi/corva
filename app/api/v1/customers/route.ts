import { handle } from "@/lib/integrations/api";
import { listCustomers } from "@/lib/integrations/read";

/** GET /api/v1/customers — the business's customers, newest first; filter by phone, email, date or text. */
export const GET = handle<unknown>((brand, _body, req) => listCustomers(brand, new URL(req.url).searchParams));
