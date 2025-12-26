import type { JSONValue, LanguageModel, ToolSet } from "ai";
import {
  isAnthropicModel,
  DEFAULT_CACHE_CONTROL_OPTIONS,
} from "./shared";

/**
 * Adds provider-specific cache control options to tools for optimal caching.
 *
 * Currently supports Anthropic models with ephemeral cache control. For Anthropic,
 * marks the last tool with `cacheControl: { type: "ephemeral" }` to enable
 * caching of the tool definitions.
 *
 * For non-Anthropic models, tools are returned unchanged.
 *
 * @param options - Configuration object
 * @param options.tools - Record of tool name to tool definition
 * @param options.model - The language model (used to determine provider-specific behavior)
 * @param options.providerOptions - Custom provider options (defaults to Anthropic ephemeral cache)
 *
 * @example
 * ```ts
 * const result = await generateText({
 *   model: anthropic('claude-3-5-haiku-latest'),
 *   tools: addCacheControlToTools({
 *     tools: {
 *       cityAttractions: tool({
 *         parameters: z.object({ city: z.string() }),
 *         execute: async ({ city }) => `Attractions in ${city}`,
 *       }),
 *     },
 *     model,
 *   }),
 *   messages: [...],
 * });
 * ```
 */
export function addCacheControlToTools<T extends ToolSet>({
  tools,
  model,
  providerOptions = DEFAULT_CACHE_CONTROL_OPTIONS,
}: {
  tools: T;
  model: LanguageModel;
  providerOptions?: Record<string, Record<string, JSONValue>>;
}): T {
  if (Object.keys(tools).length === 0) return tools;
  if (!isAnthropicModel(model)) return tools;

  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => [
      name,
      {
        ...tool,
        providerOptions: {
          ...tool.providerOptions,
          ...providerOptions,
        },
      },
    ]),
  ) as T;
}
