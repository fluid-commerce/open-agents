import type { JSONValue, LanguageModel } from "ai";

export function isAnthropicModel(model: LanguageModel): boolean {
	if (typeof model === "string") {
		return model.includes("anthropic") || model.includes("claude");
	}
	return (
		model.provider === "anthropic" ||
		model.provider.includes("anthropic") ||
		model.modelId.includes("anthropic") ||
		model.modelId.includes("claude")
	);
}

export const DEFAULT_CACHE_CONTROL_OPTIONS: Record<
	string,
	Record<string, JSONValue>
> = {
	anthropic: { cacheControl: { type: "ephemeral" } },
};
