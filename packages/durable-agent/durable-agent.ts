import {
  DurableAgent,
  type DurableAgentOptions,
  type DurableAgentStreamOptions,
  type DurableAgentStreamResult,
} from "@workflow/ai/agent";
import { durableAgentTools, type DurableAgentTools } from "./tools";
import {
  buildSystemPrompt,
  type BuildSystemPromptOptions,
} from "./system-prompt";

const DEFAULT_MAX_STEPS = 200;

export type { DurableAgentTools };

export interface CreateDurableAgentOptions {
  model?: DurableAgentOptions["model"];
  maxSteps?: number;
  systemPrompt?: BuildSystemPromptOptions;
  durableOptions?: Omit<DurableAgentOptions, "model" | "tools" | "system">;
}

export type CreateDurableAgentStreamOptions = Omit<
  DurableAgentStreamOptions<DurableAgentTools>,
  "experimental_context"
>;

export interface SandboxBoundDurableAgent {
  agent: DurableAgent<DurableAgentTools>;
  stream: (
    options: CreateDurableAgentStreamOptions,
  ) => Promise<DurableAgentStreamResult<DurableAgentTools>>;
}

export const defaultDurableAgentModel = "anthropic/claude-haiku-4.5";

export function createDurableAgent(
  sandboxId: string,
  options: CreateDurableAgentOptions = {},
): SandboxBoundDurableAgent {
  const systemPromptOptions: BuildSystemPromptOptions = {
    selectedTools: ["read", "bash", "edit", "write"],
    ...options.systemPrompt,
  };

  const agent = new DurableAgent<DurableAgentTools>({
    model: options.model ?? defaultDurableAgentModel,
    tools: durableAgentTools,
    system: buildSystemPrompt(systemPromptOptions),
    ...options.durableOptions,
  });

  return {
    agent,
    stream: (streamOptions) =>
      agent.stream({
        ...streamOptions,
        maxSteps:
          streamOptions.maxSteps ?? options.maxSteps ?? DEFAULT_MAX_STEPS,
        experimental_context: { sandboxId },
      }),
  };
}
