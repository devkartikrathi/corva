import { handle } from "@/lib/integrations/api";
import { getConversation } from "@/lib/integrations/read";

/** GET /api/v1/conversations/{id} — one conversation with its transcript. */
export const GET = handle<unknown>((brand, _body, req) => getConversation(brand, decodeURIComponent(new URL(req.url).pathname.split("/").at(-1) ?? "")));
