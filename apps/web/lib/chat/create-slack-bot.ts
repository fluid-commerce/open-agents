/**
 * Create a Slack bot instance using the Chat SDK
 *
 * This creates a per-workspace bot instance since bot tokens are stored
 * in the database (encrypted) rather than environment variables.
 */

import { Chat, ConsoleLogger } from "chat";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { createMemoryState } from "./memory-state";

const logger = new ConsoleLogger("info");

export interface CreateSlackBotOptions {
  botToken: string;
  workspaceId: string;
}

export interface SlackBotInstance {
  bot: Chat<{ slack: SlackAdapter }>;
  adapter: SlackAdapter;
}

/**
 * Create a Slack bot for a specific workspace
 *
 * Note: Bot tokens are stored encrypted in the database per-workspace,
 * so we create bot instances on-demand when handling webhooks.
 */
export function createSlackBot(
  options: CreateSlackBotOptions,
): SlackBotInstance {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    throw new Error("SLACK_SIGNING_SECRET is required");
  }

  const adapter = createSlackAdapter({
    botToken: options.botToken,
    signingSecret,
    logger: logger.child("slack"),
  });

  const bot = new Chat({
    userName: "openharness",
    logger,
    adapters: {
      slack: adapter,
    },
    state: createMemoryState(),
  });

  return { bot, adapter };
}
