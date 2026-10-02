import { handle } from "@/lib/integrations/api";
import { agentChat, agentChatUpdates, type AgentChatInput } from "@/lib/integrations/intake";

/**
 * POST /api/v1/chat — talk to the business's Corva agent.
 *
 * For sites that do not run their own AI: send the customer's message, get
 * the agent's reply. Grounded in the business's knowledge, and it records
 * leads, follow-ups and handoffs exactly as the phone line does. With
 * `stream: true` the reply comes as server-sent events.
 */
export const maxDuration = 60;

export const POST = handle<AgentChatInput>((brand, body) => agentChat(brand, { ...body, channel: undefined }));

/**
 * GET /api/v1/chat?sessionId=…&after=N — replies since turn N, for a chat a
 * person on the team has taken over.
 */
export const GET = handle<unknown>(async (brand, _body, req) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId") ?? "";
  const after = Number(url.searchParams.get("after") ?? -1);
  return agentChatUpdates(brand, sessionId, Number.isFinite(after) ? after : -1);
});
