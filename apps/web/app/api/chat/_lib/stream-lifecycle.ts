import {
  compareAndSetChatActiveStreamId,
  getChatById,
} from "@/lib/db/sessions";
import { parseStreamTokenStartedAt } from "@/lib/chat-stream-token";

export async function claimStreamOwnership(params: {
  chatId: string;
  ownedStreamToken: string;
  requestStartedAtMs: number;
}): Promise<boolean> {
  const { chatId, ownedStreamToken, requestStartedAtMs } = params;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const latestChat = await getChatById(chatId);
    const activeStreamId = latestChat?.activeStreamId ?? null;
    const activeStartedAt = parseStreamTokenStartedAt(activeStreamId);

    if (
      activeStartedAt !== null &&
      activeStartedAt > requestStartedAtMs &&
      activeStreamId !== ownedStreamToken
    ) {
      return false;
    }

    const claimed = await compareAndSetChatActiveStreamId(
      chatId,
      activeStreamId,
      ownedStreamToken,
    );

    if (claimed) {
      return true;
    }
  }

  return false;
}
