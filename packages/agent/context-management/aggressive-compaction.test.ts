import { describe, expect, test } from "bun:test";
import type { ModelMessage, StepResult, ToolSet } from "ai";
import { aggressiveCompactContext } from "./aggressive-compaction";

function createSteps(inputTokens: number): StepResult<ToolSet>[] {
  return [
    {
      usage: {
        inputTokens,
      },
    } as unknown as StepResult<ToolSet>,
  ];
}

function createConversation(toolPartCount: number, payloadSize: number): ModelMessage[] {
  const payload = "x".repeat(payloadSize);

  const assistantContent = [
    { type: "text", text: "Working on it" },
    ...Array.from({ length: toolPartCount }, (_, index) => ({
      type: "tool-call",
      toolCallId: `call-${index}`,
      toolName: "read",
      input: { filePath: `/tmp/file-${index}.txt`, payload },
    })),
  ];

  const toolContent = Array.from({ length: toolPartCount }, (_, index) => ({
    type: "tool-result",
    toolCallId: `call-${index}`,
    toolName: "read",
    output: { value: payload },
  }));

  return [
    { role: "user", content: "Please inspect the files." },
    {
      role: "assistant",
      content: assistantContent,
    } as unknown as ModelMessage,
    {
      role: "tool",
      content: toolContent,
    } as unknown as ModelMessage,
  ];
}

function countToolParts(messages: ModelMessage[]): number {
  return messages.reduce((total, message) => {
    if (!Array.isArray(message.content)) {
      return total;
    }

    const toolPartsInMessage = message.content.filter(
      (part) => part.type === "tool-call" || part.type === "tool-result",
    ).length;

    return total + toolPartsInMessage;
  }, 0);
}

describe("aggressiveCompactContext", () => {
  test("compacts a short conversation with heavy tool-call history", () => {
    const messages = createConversation(80, 1200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(50_000),
    });

    expect(countToolParts(compacted)).toBe(0);
    expect(compacted.some((message) => message.role === "tool")).toBe(false);
    expect(compacted.length).toBe(2);
  });

  test("does not compact when input tokens are below threshold", () => {
    const messages = createConversation(80, 1200);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(39_000),
    });

    expect(compacted).toBe(messages);
  });

  test("does not compact when removable tool tokens are below min savings", () => {
    const messages = createConversation(1, 20);

    const compacted = aggressiveCompactContext({
      messages,
      steps: createSteps(50_000),
    });

    expect(compacted).toBe(messages);
  });
});
