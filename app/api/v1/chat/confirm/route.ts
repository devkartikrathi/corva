import { handle } from "@/lib/integrations/api";
import { agentChatConfirm, type AgentChatConfirmInput } from "@/lib/integrations/intake";

/**
 * POST /api/v1/chat/confirm — the customer tapped Confirm or Edit on a card.
 *
 * Confirm makes the booking or callback the agent proposed; Edit hands the
 * chat back to the agent to change the details.
 */
export const maxDuration = 30;

export const POST = handle<AgentChatConfirmInput>((brand, body) => agentChatConfirm(brand, body));
