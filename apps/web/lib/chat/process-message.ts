/**
 * Process Slack messages with the AI agent using Chat SDK
 *
 * Uses the Chat SDK's native streaming support for real-time responses.
 */

import type { Thread } from "chat";
import { discoverSkills } from "@open-harness/agent";
import { connectSandbox, type SandboxState } from "@open-harness/sandbox";
import { convertToModelMessages, gateway, readUIMessageStream } from "ai";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { webAgent } from "@/app/config";
import type { WebAgentUIMessage } from "@/app/types";
import { decrypt } from "@/lib/crypto";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import {
  getTaskById,
  getTaskMessages,
  updateTask,
  createTaskMessageIfNotExists,
  upsertTaskMessage,
} from "@/lib/db/tasks";
import { DEFAULT_MODEL_ID } from "@/lib/models";
import { isSandboxActive } from "@/lib/sandbox/utils";

export interface ProcessSlackMessageParams {
  taskId: string;
  userId: string;
  message: string;
  thread: Thread;
  workspaceId: string;
  /** Optional repo to clone (format: owner/repo) */
  repo?: string;
}

async function getUserGitHubTokenById(userId: string): Promise<string | null> {
  try {
    const user = await db
      .select({ accessToken: users.accessToken })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.provider, "github")))
      .limit(1);

    if (user[0]?.accessToken) {
      return decrypt(user[0].accessToken);
    }

    return null;
  } catch (error) {
    console.error("Error fetching GitHub token:", error);
    return null;
  }
}

function createSandboxState(repo?: string, token?: string): SandboxState {
  if (repo) {
    const repoUrl = repo.startsWith("https://")
      ? repo
      : `https://github.com/${repo}`;
    return {
      type: "vercel",
      source: {
        repo: repoUrl,
        branch: "main",
        ...(token && { token }),
      },
    };
  }
  return { type: "vercel" };
}

/**
 * Process a Slack message with the AI agent using native streaming
 */
export async function processSlackMessage(
  params: ProcessSlackMessageParams,
): Promise<void> {
  const { taskId, userId, message, thread, repo } = params;

  try {
    // 1. Get task and validate
    const task = await getTaskById(taskId);
    if (!task) {
      await thread.post("Task not found. Please try again.");
      return;
    }

    // 2. Get existing messages for context
    const existingMessages = await getTaskMessages(taskId);
    const messages: WebAgentUIMessage[] = existingMessages.map((m) => ({
      ...(m.parts as WebAgentUIMessage),
      id: m.id,
      role: m.role as "user" | "assistant",
    }));

    // 3. Add the new user message
    const userMessageId = nanoid();
    const userMessage: WebAgentUIMessage = {
      id: userMessageId,
      role: "user",
      parts: [{ type: "text", text: message }],
    };
    messages.push(userMessage);

    // Save user message
    await createTaskMessageIfNotExists({
      id: userMessageId,
      taskId,
      role: "user",
      parts: userMessage,
    });

    // Get GitHub token
    const githubToken = await getUserGitHubTokenById(userId);

    // 4. Connect to sandbox
    let sandboxState = task.sandboxState;
    if (!isSandboxActive(sandboxState)) {
      sandboxState = createSandboxState(repo, githubToken ?? undefined);
      await updateTask(taskId, { sandboxState });
    }

    const sandbox = await connectSandbox(sandboxState, {
      env: githubToken ? { GITHUB_TOKEN: githubToken } : undefined,
      timeout: 10 * 60 * 1000,
    });

    // 5. Discover skills
    const skillBaseFolders = [".claude", ".agents"];
    const skillDirs = skillBaseFolders.map(
      (folder) => `${sandbox.workingDirectory}/${folder}/skills`,
    );
    const skills = await discoverSkills(sandbox, skillDirs);

    // 6. Convert messages to model format
    const modelMessages = await convertToModelMessages(messages, {
      ignoreIncompleteToolCalls: true,
      tools: webAgent.tools,
    });

    // 7. Resolve model
    const modelId = task.modelId ?? DEFAULT_MODEL_ID;
    let model;
    try {
      model = gateway(modelId);
    } catch (error) {
      console.error(
        `Invalid model ID "${modelId}", falling back to default:`,
        error,
      );
      model = gateway(DEFAULT_MODEL_ID);
    }

    // 8. Run the agent
    const result = await webAgent.stream({
      messages: modelMessages,
      options: {
        sandbox,
        model,
        approval: {
          type: "interactive",
          autoApprove: "all",
          sessionRules: [],
        },
        ...(skills.length > 0 && { skills }),
      },
    });

    // 9. Create UI message stream for persistence
    let responseMessage: WebAgentUIMessage | undefined;

    const uiStream = result.toUIMessageStream<WebAgentUIMessage>({
      generateMessageId: nanoid,
    });

    const persistMessage = async () => {
      for await (const message of readUIMessageStream<WebAgentUIMessage>({
        stream: uiStream,
      })) {
        responseMessage = message;
      }
    };

    // 10. Stream to Slack using Chat SDK's native streaming
    await Promise.all([thread.post(result.textStream), persistMessage()]);

    // 11. Save assistant message
    if (responseMessage) {
      await upsertTaskMessage({
        id: responseMessage.id,
        taskId,
        role: "assistant",
        parts: responseMessage,
      });
    }

    // 12. Persist sandbox state
    if (sandbox.getState) {
      try {
        const currentState = sandbox.getState() as SandboxState;
        await updateTask(taskId, { sandboxState: currentState });
      } catch (error) {
        console.error("Failed to persist sandbox state:", error);
      }
    }

    // 13. Update task status
    await updateTask(taskId, { status: "completed" });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error processing Slack message:", errorMessage);

    await thread.post(
      `I encountered an error:\n\`\`\`\n${errorMessage}\n\`\`\``,
    );

    await updateTask(taskId, { status: "failed" });
  }
}
