import { handle } from "@/lib/integrations/api";
import { syncChat, type ChatSyncInput } from "@/lib/integrations/intake";

/**
 * POST /api/v1/chats — the whole transcript of a website chat, as it grows.
 *
 * Send it after each reply; Corva keeps one conversation per `sessionId` and
 * replaces its transcript, so it shows on the live console and in the archive.
 */
export const POST = handle<ChatSyncInput>((brand, body) => syncChat(brand, body));
