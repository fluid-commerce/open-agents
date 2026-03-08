import type { ModelMessage } from "ai";
import { shouldApplyOpenAIReasoningDefaults } from "../models";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface OpenAIReasoningMetadata {
  hasOpenAIOptions: boolean;
  itemId: string | null;
  encryptedContent: string | null;
}

function getOpenAIReasoningMetadata(part: unknown): OpenAIReasoningMetadata {
  if (
    !part ||
    typeof part !== "object" ||
    (part as { type?: unknown }).type !== "reasoning"
  ) {
    return {
      hasOpenAIOptions: false,
      itemId: null,
      encryptedContent: null,
    };
  }

  const providerOptions =
    "providerOptions" in part
      ? (part as { providerOptions?: unknown }).providerOptions
      : undefined;
  const openaiOptions =
    isRecord(providerOptions) && isRecord(providerOptions.openai)
      ? providerOptions.openai
      : null;

  if (!openaiOptions) {
    return {
      hasOpenAIOptions: false,
      itemId: null,
      encryptedContent: null,
    };
  }

  const itemId =
    typeof openaiOptions.itemId === "string" && openaiOptions.itemId.length > 0
      ? openaiOptions.itemId
      : null;
  const encryptedContent =
    typeof openaiOptions.reasoningEncryptedContent === "string" &&
    openaiOptions.reasoningEncryptedContent.trim().length > 0
      ? openaiOptions.reasoningEncryptedContent
      : null;

  return {
    hasOpenAIOptions: true,
    itemId,
    encryptedContent,
  };
}

export function stripInvalidOpenAIReasoningParts(
  messages: ModelMessage[],
  modelId: string,
): { messages: ModelMessage[]; strippedBlocks: number } {
  if (!shouldApplyOpenAIReasoningDefaults(modelId)) {
    return { messages, strippedBlocks: 0 };
  }

  const itemIdsWithEncryptedContent = new Set<string>();

  for (const message of messages) {
    if (
      !message ||
      message.role !== "assistant" ||
      typeof message.content === "string"
    ) {
      continue;
    }

    for (const part of message.content) {
      const metadata = getOpenAIReasoningMetadata(part);
      if (metadata.itemId && metadata.encryptedContent) {
        itemIdsWithEncryptedContent.add(metadata.itemId);
      }
    }
  }

  let sanitizedMessages: ModelMessage[] | null = null;
  let strippedBlocks = 0;

  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const message = messages[messageIndex];
    if (
      !message ||
      message.role !== "assistant" ||
      typeof message.content === "string"
    ) {
      continue;
    }

    let sanitizedContent: typeof message.content | null = null;

    for (
      let partIndex = 0;
      partIndex < message.content.length;
      partIndex += 1
    ) {
      const part = message.content[partIndex];
      const metadata = getOpenAIReasoningMetadata(part);

      const shouldStrip =
        metadata.encryptedContent === null &&
        ((metadata.itemId !== null &&
          !itemIdsWithEncryptedContent.has(metadata.itemId)) ||
          (metadata.itemId === null && metadata.hasOpenAIOptions));

      if (!shouldStrip) {
        if (sanitizedContent && part) {
          sanitizedContent.push(part);
        }
        continue;
      }

      sanitizedMessages ??= messages.slice();
      sanitizedContent ??= message.content.slice(0, partIndex);
      strippedBlocks += 1;
    }

    if (sanitizedContent) {
      sanitizedMessages ??= messages.slice();
      sanitizedMessages[messageIndex] = {
        ...message,
        content: sanitizedContent,
      };
    }
  }

  if (!sanitizedMessages) {
    return { messages, strippedBlocks: 0 };
  }

  return { messages: sanitizedMessages, strippedBlocks };
}
