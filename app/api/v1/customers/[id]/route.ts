import { handle } from "@/lib/integrations/api";
import { getCustomer } from "@/lib/integrations/read";

/** GET /api/v1/customers/{id} — one customer: everything collected about them, their leads and conversations. */
export const GET = handle<unknown>((brand, _body, req) => getCustomer(brand, decodeURIComponent(new URL(req.url).pathname.split("/").at(-1) ?? "")));
