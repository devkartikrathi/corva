import { handle } from "@/lib/integrations/api";
import { listConversations } from "@/lib/integrations/read";

/** GET /api/v1/conversations — chats and calls, newest first, with the details each one collected. */
export const GET = handle<unknown>((brand, _body, req) => listConversations(brand, new URL(req.url).searchParams));
