import type { Sandbox } from "@open-harness/sandbox";
import {
  gateway,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  type TypedToolResult,
} from "ai";
import { z } from "zod";
import { addCacheControl } from "./context-management";
import { aggressiveCompactContext } from "./context-management/aggressive-compaction";

import type { SkillMetadata } from "./skills/types";
import { buildSystemPrompt } from "./system-prompt";
import {
  askUserQuestionTool,
  bashTool,
  editFileTool,
  globTool,
  grepTool,
  readFileTool,
  skillTool,
  taskTool,
  todoWriteTool,
  webFetchTool,
  writeFileTool,
} from "./tools";
import type { ApprovalConfig, TodoItem } from "./types";
import { approvalRuleSchema } from "./types";

const approvalConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("interactive"),
    autoApprove: z.enum(["off", "edits", "all"]).default("off"),
    sessionRules: z.array(approvalRuleSchema).default([]),
  }),
  z.object({ type: z.literal("background") }),
  z.object({ type: z.literal("delegated") }),
]);

const compactionContextSchema = z.object({
  contextLimit: z.number().int().positive().optional(),
  lastInputTokens: z.number().int().nonnegative().optional(),
});

const callOptionsSchema = z.object({
  sandbox: z.custom<Sandbox>(),
  approval: approvalConfigSchema,
  model: z.custom<LanguageModel>().optional(),
  subagentModel: z.custom<LanguageModel>().optional(),
  customInstructions: z.string().optional(),
  skills: z.custom<SkillMetadata[]>().optional(),
  context: compactionContextSchema.optional(),
});

type CompactionContext = z.infer<typeof compactionContextSchema>;

export type OpenHarnessAgentCallOptions = z.infer<typeof callOptionsSchema>;

function getCompactionContextFromExperimentalContext(
  experimentalContext: unknown,
): CompactionContext | undefined {
  if (!experimentalContext || typeof experimentalContext !== "object") {
    return undefined;
  }

  const contextValue = (experimentalContext as { context?: unknown }).context;
  const parsed = compactionContextSchema.safeParse(contextValue);
  return parsed.success ? parsed.data : undefined;
}

const DEFAULT_CONTEXT_LIMIT = 200_000;

interface CompactionTuning {
  triggerPercent: number;
  minSavingsPercent: number;
  retainRecentToolCalls: number;
}

const DEFAULT_COMPACTION_TUNING: CompactionTuning = {
  triggerPercent: 0.58,
  minSavingsPercent: 0.03,
  retainRecentToolCalls: 32,
};

/**
 * Optional model-specific compaction tuning overrides.
 *
 * Keys support exact matches ("provider/model") and partial matches
 * (any substring of the full model id).
 */
const MODEL_COMPACTION_TUNING_OVERRIDES: Record<
  string,
  Partial<CompactionTuning>
> = {};

function getModelId(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

const ENABLE_REASONING_DEBUG_LOGS =
  process.env.OPEN_HARNESS_LOG_REASONING === "1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logStepReasoningBlocks(
  messages: ModelMessage[],
  context: {
    modelId: string;
    stepNumber: number;
    stage: "before-compaction" | "after-compaction";
  },
): void {
  if (!ENABLE_REASONING_DEBUG_LOGS) {
    return;
  }

  const reasoningBlocks: Array<Record<string, unknown>> = [];

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

    for (
      let partIndex = 0;
      partIndex < message.content.length;
      partIndex += 1
    ) {
      const part = message.content[partIndex];
      if (!part || part.type !== "reasoning") {
        continue;
      }

      const providerOptions =
        "providerOptions" in part ? part.providerOptions : undefined;
      const openaiOptions =
        isRecord(providerOptions) && isRecord(providerOptions.openai)
          ? providerOptions.openai
          : null;

      const itemId =
        openaiOptions && typeof openaiOptions.itemId === "string"
          ? openaiOptions.itemId
          : null;
      const encryptedContent =
        openaiOptions &&
        typeof openaiOptions.reasoningEncryptedContent === "string"
          ? openaiOptions.reasoningEncryptedContent
          : null;

      reasoningBlocks.push({
        messageIndex,
        partIndex,
        itemId,
        reasoningTextLength: part.text.length,
        encryptedContentLength: encryptedContent?.length ?? null,
      });
    }
  }

  console.log(
    "[reasoning-debug][agent][step]",
    JSON.stringify(
      {
        ...context,
        messageCount: messages.length,
        reasoningBlockCount: reasoningBlocks.length,
        reasoningBlocks,
      },
      null,
      2,
    ),
  );
}

function stripInvalidOpenAIReasoningParts(
  messages: ModelMessage[],
  modelId: string,
): { messages: ModelMessage[]; strippedBlocks: number } {
  if (!modelId.startsWith("openai/")) {
    return { messages, strippedBlocks: 0 };
  }

  let strippedBlocks = 0;

  const sanitizedMessages = messages.map((message) => {
    if (
      !message ||
      message.role !== "assistant" ||
      typeof message.content === "string"
    ) {
      return message;
    }

    let changed = false;
    const sanitizedContent = message.content.filter((part) => {
      if (!part || part.type !== "reasoning") {
        return true;
      }

      const providerOptions =
        "providerOptions" in part ? part.providerOptions : undefined;
      const openaiOptions =
        isRecord(providerOptions) && isRecord(providerOptions.openai)
          ? providerOptions.openai
          : null;
      if (!openaiOptions) {
        return true;
      }

      const itemId = openaiOptions.itemId;
      if (typeof itemId !== "string" || itemId.length === 0) {
        return true;
      }

      const encryptedContent = openaiOptions.reasoningEncryptedContent;
      if (
        typeof encryptedContent === "string" &&
        encryptedContent.trim().length > 0
      ) {
        return true;
      }

      strippedBlocks += 1;
      changed = true;
      return false;
    });

    return changed ? { ...message, content: sanitizedContent } : message;
  });

  return { messages: sanitizedMessages, strippedBlocks };
}

function resolveCompactionTuning(model: LanguageModel): CompactionTuning {
  const modelId = getModelId(model);

  const exactMatch = MODEL_COMPACTION_TUNING_OVERRIDES[modelId];
  if (exactMatch) {
    return {
      ...DEFAULT_COMPACTION_TUNING,
      ...exactMatch,
    };
  }

  const partialMatch = Object.entries(MODEL_COMPACTION_TUNING_OVERRIDES).find(
    ([key]) => modelId.includes(key),
  );

  if (partialMatch?.[1]) {
    return {
      ...DEFAULT_COMPACTION_TUNING,
      ...partialMatch[1],
    };
  }

  return DEFAULT_COMPACTION_TUNING;
}

export const defaultModel = gateway("anthropic/claude-haiku-4.5");
export const defaultModelLabel = defaultModel.modelId;

const tools = {
  todo_write: todoWriteTool,
  read: readFileTool(),
  write: writeFileTool(),
  edit: editFileTool(),
  grep: grepTool(),
  glob: globTool(),
  bash: bashTool(),
  task: taskTool,
  ask_user_question: askUserQuestionTool,
  skill: skillTool,
  web_fetch: webFetchTool,
} satisfies ToolSet;

export const openHarnessAgent = new ToolLoopAgent({
  model: defaultModel,
  instructions: buildSystemPrompt({}),
  tools,
  stopWhen: stepCountIs(100),
  callOptionsSchema,
  prepareStep: ({ messages, model, steps, experimental_context }) => {
    const callContext =
      getCompactionContextFromExperimentalContext(experimental_context);
    const compactionTuning = resolveCompactionTuning(model);
    const modelId = getModelId(model);
    const stepNumber = steps.length + 1;

    logStepReasoningBlocks(messages, {
      modelId,
      stepNumber,
      stage: "before-compaction",
    });

    const { messages: sanitizedMessages, strippedBlocks } =
      stripInvalidOpenAIReasoningParts(messages, modelId);

    if (strippedBlocks > 0) {
      console.warn(
        `[agent] Stripped ${strippedBlocks} OpenAI reasoning parts missing reasoningEncryptedContent before step ${stepNumber} (${modelId}).`,
      );
    }

    const compactedMessages = aggressiveCompactContext({
      messages: sanitizedMessages,
      steps,
      contextLimit: callContext?.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
      lastInputTokens: callContext?.lastInputTokens,
      triggerPercent: compactionTuning.triggerPercent,
      minSavingsPercent: compactionTuning.minSavingsPercent,
      retainRecentToolCalls: compactionTuning.retainRecentToolCalls,
    });

    const preparedMessages = addCacheControl({
      messages: compactedMessages,
      model,
    });

    logStepReasoningBlocks(preparedMessages, {
      modelId,
      stepNumber,
      stage: "after-compaction",
    });

    return {
      messages: preparedMessages,
    };
  },
  prepareCall: ({ options, model, ...settings }) => {
    if (!options) {
      throw new Error(
        "Open Harness agent requires call options with sandbox and approval config.",
      );
    }
    const approval: ApprovalConfig = options.approval;
    const callModel = options.model ?? model;
    const subagentModel = options.subagentModel;
    const customInstructions = options.customInstructions;
    const sandbox = options.sandbox;
    const skills = options.skills ?? [];
    const context = options.context;

    // Derive mode for system prompt (interactive vs background)
    const mode = approval.type === "background" ? "background" : "interactive";

    const instructions = buildSystemPrompt({
      cwd: sandbox.workingDirectory,
      mode,
      currentBranch: sandbox.currentBranch,
      customInstructions,
      environmentDetails: sandbox.environmentDetails,
      skills,
      modelId: typeof callModel === "string" ? callModel : callModel.modelId,
    });

    return {
      ...settings,
      model: callModel,
      tools: addCacheControl({
        tools: settings.tools ?? tools,
        model: callModel,
      }),
      instructions,
      experimental_context: {
        sandbox,
        approval,
        skills,
        model: callModel,
        subagentModel,
        context,
      },
    };
  },
});

export function extractTodosFromStep(
  toolResults: Array<TypedToolResult<typeof openHarnessAgent.tools>>,
): TodoItem[] | null {
  for (const result of toolResults) {
    if (!result.dynamic && result.toolName === "todo_write" && result.output) {
      return result.output.todos;
    }
  }
  return null;
}

export type OpenHarnessAgent = typeof openHarnessAgent;
