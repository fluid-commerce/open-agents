/**
 * Format agent messages for Slack
 *
 * Converts UI message parts into Slack-friendly text format:
 * - Text parts become the main message body
 * - Tool parts are summarized as action items
 * - Long messages are chunked to respect Slack's 4000 char limit
 */

import { isToolUIPart, isTextUIPart, getToolName } from "ai";
import type { WebAgentUIMessagePart } from "@/app/types";

const SLACK_MAX_LENGTH = 4000;
const TRUNCATE_BUFFER = 100; // Leave buffer for "... (truncated)" suffix

/**
 * Format tool parts into concise action summaries
 */
function formatToolAction(part: WebAgentUIMessagePart): string | null {
  if (!isToolUIPart(part)) return null;

  const toolName = getToolName(part);
  const input = part.input as Record<string, unknown> | undefined;
  const state = part.state;

  // Determine status icon
  let icon = "...";
  if (state === "output-available") {
    icon = "\u2713"; // checkmark
  } else if (state === "output-error" || state === "output-denied") {
    icon = "\u2717"; // X mark
  }

  // Format based on tool type
  switch (toolName) {
    case "read": {
      const filePath = input?.filePath ?? input?.file_path;
      return filePath ? `${icon} Read: ${filePath}` : null;
    }
    case "write": {
      const filePath = input?.filePath ?? input?.file_path;
      return filePath ? `${icon} Write: ${filePath}` : null;
    }
    case "edit": {
      const filePath = input?.filePath ?? input?.file_path;
      return filePath ? `${icon} Edit: ${filePath}` : null;
    }
    case "bash": {
      const command = input?.command;
      if (!command) return null;
      const cmdStr = String(command);
      const truncatedCmd =
        cmdStr.length > 50 ? cmdStr.slice(0, 50) + "..." : cmdStr;
      // Include exit code if available
      if (state === "output-available") {
        const output = part.output as { exitCode?: number } | undefined;
        const exitCode = output?.exitCode;
        if (exitCode !== undefined) {
          return `${icon} Bash: \`${truncatedCmd}\` (exit ${exitCode})`;
        }
      }
      return `${icon} Bash: \`${truncatedCmd}\``;
    }
    case "glob": {
      const pattern = input?.pattern;
      return pattern ? `${icon} Glob: "${pattern}"` : null;
    }
    case "grep": {
      const pattern = input?.pattern;
      return pattern ? `${icon} Grep: "${pattern}"` : null;
    }
    case "task": {
      const taskDesc = input?.task ?? input?.description;
      const subagentType = input?.subagentType ?? input?.subagent_type;
      if (taskDesc) {
        const desc = String(taskDesc);
        const truncatedDesc =
          desc.length > 40 ? desc.slice(0, 40) + "..." : desc;
        const typeLabel = subagentType ? ` (${subagentType})` : "";
        return `${icon} Task${typeLabel}: ${truncatedDesc}`;
      }
      return null;
    }
    case "ask_user_question": {
      return `${icon} Asked question`;
    }
    case "skill": {
      const skillName = input?.skill ?? input?.name;
      return skillName ? `${icon} Skill: ${skillName}` : null;
    }
    case "todo_write": {
      return `${icon} Updated task list`;
    }
    default:
      return `${icon} ${toolName}`;
  }
}

/**
 * Extract text content from message parts
 */
function extractText(parts: WebAgentUIMessagePart[]): string {
  const textParts: string[] = [];

  for (const part of parts) {
    if (isTextUIPart(part) && part.text) {
      textParts.push(part.text);
    }
  }

  return textParts.join("\n\n");
}

/**
 * Extract tool action summaries from message parts
 */
function extractToolActions(parts: WebAgentUIMessagePart[]): string[] {
  const actions: string[] = [];

  for (const part of parts) {
    const action = formatToolAction(part);
    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

/**
 * Chunk a message to fit within Slack's character limit
 */
function chunkMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (newline or space)
    let breakPoint = maxLength - TRUNCATE_BUFFER;
    const newlineIdx = remaining.lastIndexOf("\n", breakPoint);
    const spaceIdx = remaining.lastIndexOf(" ", breakPoint);

    if (newlineIdx > breakPoint * 0.5) {
      breakPoint = newlineIdx;
    } else if (spaceIdx > breakPoint * 0.5) {
      breakPoint = spaceIdx;
    }

    chunks.push(remaining.slice(0, breakPoint));
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

export interface FormattedSlackMessage {
  /** Main message chunks (may be multiple if content exceeds limit) */
  chunks: string[];
  /** Whether any tool actions were performed */
  hasActions: boolean;
  /** Whether there's text content */
  hasText: boolean;
}

/**
 * Format agent message parts for Slack posting
 *
 * Returns message chunks that respect Slack's 4000 char limit.
 * Format:
 * - Main text content
 * - Separator
 * - Tool actions list
 */
export function formatAgentMessageForSlack(
  parts: WebAgentUIMessagePart[],
): FormattedSlackMessage {
  const text = extractText(parts);
  const actions = extractToolActions(parts);

  const hasText = text.length > 0;
  const hasActions = actions.length > 0;

  // Build the message
  const messageParts: string[] = [];

  if (hasText) {
    messageParts.push(text);
  }

  if (hasActions) {
    // Add actions section
    const actionsHeader = hasText
      ? "\n\n---\n*Actions taken:*\n"
      : "*Actions taken:*\n";
    messageParts.push(actionsHeader + actions.join("\n"));
  }

  const fullMessage = messageParts.join("");

  // Handle empty message
  if (!fullMessage) {
    return { chunks: [], hasActions: false, hasText: false };
  }

  // Chunk if needed
  const chunks = chunkMessage(fullMessage, SLACK_MAX_LENGTH);

  return { chunks, hasActions, hasText };
}

/**
 * Format an error message for Slack
 */
export function formatErrorForSlack(error: string): string {
  return `I encountered an error while processing your request:\n\`\`\`\n${error}\n\`\`\``;
}

/**
 * Format a "working on it" message
 */
export function formatWorkingMessage(): string {
  return "Thinking...";
}
