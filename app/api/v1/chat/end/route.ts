import { handle } from "@/lib/integrations/api";
import { agentChatEnd } from "@/lib/integrations/intake";

/**
 * POST /api/v1/chat/end — the customer has left the chat (closed the window,
 * reloaded, started a new one). `{ sessionId }`. Ends the conversation now;
 * otherwise it is ended after 30 quiet minutes.
 */
export const POST = handle<{ sessionId?: unknown }>((brand, body) => agentChatEnd(brand, body));
