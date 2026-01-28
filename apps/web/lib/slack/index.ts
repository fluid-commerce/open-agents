/**
 * Slack integration module
 *
 * Provides utilities for integrating with Slack:
 * - API helpers for posting/updating messages
 * - Message formatting for agent responses
 * - AI agent message processing
 */

export { postSlackMessage, updateSlackMessage } from "./api";
export {
  formatAgentMessageForSlack,
  formatErrorForSlack,
  formatWorkingMessage,
  type FormattedSlackMessage,
} from "./format-message";
