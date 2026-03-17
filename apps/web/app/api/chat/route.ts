import { createUIMessageStreamResponse, type InferUIMessageChunk } from "ai";
import { start } from "workflow/api";
import type { WebAgentUIMessage } from "@/app/types";
import {
  createChatMessageIfNotExists,
  isFirstChatMessage,
  touchChat,
  updateChat,
  updateChatActiveStreamId,
  updateSession,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { createCancelableReadableStream } from "@/lib/chat/create-cancelable-readable-stream";
import { buildActiveLifecycleUpdate } from "@/lib/sandbox/lifecycle";
import {
  requireAuthenticatedUser,
  requireOwnedSessionChat,
} from "./_lib/chat-context";
import { resolveChatModelSelection } from "./_lib/model-selection";
import { parseChatRequestBody, requireChatIdentifiers } from "./_lib/request";
import { createChatRuntime } from "./_lib/runtime";
import { runAgentWorkflow } from "@/app/workflows/chat";

export const maxDuration = 800;

type WebAgentUIMessageChunk = InferUIMessageChunk<WebAgentUIMessage>;

export async function POST(req: Request) {
  // 1. Validate session
  const authResult = await requireAuthenticatedUser();
  if (!authResult.ok) {
    return authResult.response;
  }
  const userId = authResult.userId;

  const parsedBody = await parseChatRequestBody(req);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const { messages } = parsedBody.body;

  // 2. Require sessionId and chatId to ensure sandbox ownership verification
  const chatIdentifiers = requireChatIdentifiers(parsedBody.body);
  if (!chatIdentifiers.ok) {
    return chatIdentifiers.response;
  }
  const { sessionId, chatId } = chatIdentifiers;

  // 3. Verify session + chat ownership
  const chatContext = await requireOwnedSessionChat({
    userId,
    sessionId,
    chatId,
    forbiddenMessage: "Unauthorized",
    requireActiveSandbox: true,
    sandboxInactiveMessage: "Sandbox not initialized",
  });
  if (!chatContext.ok) {
    return chatContext.response;
  }

  const { sessionRecord, chat } = chatContext;
  const activeSandboxState = sessionRecord.sandboxState;
  if (!activeSandboxState) {
    throw new Error("Sandbox not initialized");
  }

  const requestStartedAt = new Date();

  // Refresh lifecycle activity so long-running responses don't look idle.
  await updateSession(sessionId, {
    ...buildActiveLifecycleUpdate(sessionRecord.sandboxState, {
      activityAt: requestStartedAt,
    }),
  });

  // Persist the latest user message immediately (fire-and-forget) so it's
  // in the DB before the workflow starts. This ensures a page refresh
  // during workflow queue time still shows the message.
  void persistLatestUserMessage(chatId, messages);

  const runtimePromise = createChatRuntime({
    userId,
    sessionId,
    sessionRecord,
  });
  const preferencesPromise = getUserPreferences(userId).catch((error) => {
    console.error("Failed to load user preferences:", error);
    return null;
  });

  const [{ sandbox, skills }, preferences] = await Promise.all([
    runtimePromise,
    preferencesPromise,
  ]);

  const modelVariants = preferences?.modelVariants ?? [];
  const mainModelSelection = resolveChatModelSelection({
    selectedModelId: chat.modelId,
    modelVariants,
    missingVariantLabel: "Selected model variant",
  });
  const subagentModelSelection = preferences?.defaultSubagentModelId
    ? resolveChatModelSelection({
        selectedModelId: preferences.defaultSubagentModelId,
        modelVariants,
        missingVariantLabel: "Subagent model variant",
      })
    : undefined;

  // Determine if auto-commit should run after a natural finish.
  const shouldAutoCommitPush =
    sessionRecord.autoCommitPushOverride ??
    preferences?.autoCommitPush ??
    false;

  // Start the durable workflow
  const run = await start(runAgentWorkflow, [
    {
      messages,
      chatId,
      sessionId,
      userId,
      modelId: mainModelSelection.id,
      agentOptions: {
        sandbox: {
          state: activeSandboxState,
          workingDirectory: sandbox.workingDirectory,
          currentBranch: sandbox.currentBranch,
          environmentDetails: sandbox.environmentDetails,
        },
        model: mainModelSelection,
        ...(subagentModelSelection
          ? { subagentModel: subagentModelSelection }
          : {}),
        ...(skills.length > 0 && { skills }),
      },
      ...(shouldAutoCommitPush &&
        sessionRecord.repoOwner &&
        sessionRecord.repoName && {
          autoCommitEnabled: true,
          sessionTitle: sessionRecord.title,
          repoOwner: sessionRecord.repoOwner,
          repoName: sessionRecord.repoName,
        }),
    },
  ]);

  // Store the workflow run ID so clients can reconnect and stop.
  await updateChatActiveStreamId(chatId, run.runId);

  const stream = createCancelableReadableStream(
    run.getReadable<WebAgentUIMessageChunk>(),
  );

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "x-workflow-run-id": run.runId,
    },
  });
}

async function persistLatestUserMessage(
  chatId: string,
  messages: WebAgentUIMessage[],
): Promise<void> {
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== "user") {
    return;
  }

  try {
    const created = await createChatMessageIfNotExists({
      id: latestMessage.id,
      chatId,
      role: "user",
      parts: latestMessage,
    });

    if (!created) {
      return;
    }

    await touchChat(chatId);

    const shouldSetTitle = await isFirstChatMessage(chatId, created.id);
    if (!shouldSetTitle) {
      return;
    }

    const textContent = latestMessage.parts
      .filter(
        (part): part is { type: "text"; text: string } => part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim();

    if (textContent.length > 0) {
      const title =
        textContent.length > 30
          ? `${textContent.slice(0, 30)}...`
          : textContent;
      await updateChat(chatId, { title });
    }
  } catch (error) {
    console.error("Failed to persist user message:", error);
  }
}
