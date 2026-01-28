import { type NextRequest, after } from "next/server";
import { nanoid } from "nanoid";
import {
  getConnectedAppByWorkspace,
  decryptBotToken,
} from "@/lib/db/connected-apps";
import { getLinkedAccountByProviderAndExternalId } from "@/lib/db/linked-accounts";
import { createTask, getTaskBySource, updateTask } from "@/lib/db/tasks";
import { createSlackBot } from "@/lib/chat/create-slack-bot";
import { processSlackMessage } from "@/lib/chat/process-message";

export async function POST(req: NextRequest): Promise<Response> {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET not configured");
    return new Response("Server configuration error", { status: 500 });
  }

  // Get the raw body for parsing
  const body = await req.text();

  let payload: {
    type: string;
    challenge?: string;
    team_id?: string;
    event?: {
      type: string;
      user?: string;
      channel?: string;
      text?: string;
      ts?: string;
      thread_ts?: string;
    };
  };

  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Handle URL verification challenge
  if (payload.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: payload.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only handle event callbacks
  if (payload.type !== "event_callback" || !payload.team_id) {
    return new Response("OK", { status: 200 });
  }

  const teamId = payload.team_id;

  // Get the connected app for this workspace
  const connectedApp = await getConnectedAppByWorkspace("slack", teamId);
  if (!connectedApp) {
    console.error(`No connected app found for Slack workspace: ${teamId}`);
    return new Response("Workspace not configured", { status: 404 });
  }

  // Decrypt the bot token
  const botToken = decryptBotToken(connectedApp.botToken);
  if (!botToken) {
    console.error("Failed to decrypt bot token");
    return new Response("Token decryption failed", { status: 500 });
  }

  // Create Chat SDK bot instance and register handler
  const { bot } = createSlackBot({ botToken, workspaceId: teamId });

  // Register the mention handler
  bot.onNewMention(async (thread, message) => {
    const event = payload.event;
    if (!event?.user || !event.channel) return;

    const user = event.user;
    const channel = event.channel;
    const threadTs = event.thread_ts ?? event.ts ?? "";

    // Look up linked web user from Slack user ID
    const linkedAccount = await getLinkedAccountByProviderAndExternalId(
      "slack",
      user,
      teamId,
    );

    if (!linkedAccount) {
      const baseUrl = process.env.APP_URL ?? "https://openharness.dev";
      await thread.post(
        `To use me, please link your Slack account first:\n${baseUrl}/settings/connectors\n\nOnce linked, mention me again and I'll help you with your task.`,
      );
      return;
    }

    // Clean the message text (remove bot mention)
    let cleanText = message.text.replace(/<@[A-Z0-9]+>/g, "").trim();

    // Parse repo=owner/repo parameter if present
    let repoParam: string | undefined;
    const repoMatch = cleanText.match(/\brepo=([^\s]+)/i);
    if (repoMatch?.[1]) {
      repoParam = repoMatch[1];
      cleanText = cleanText.replace(/\brepo=[^\s]+/i, "").trim();
    }

    if (!cleanText) {
      await thread.post(
        "What would you like me to help you with? Just mention me with your request.",
      );
      return;
    }

    // Check for existing task in this thread
    const existingTask = await getTaskBySource({
      provider: "slack",
      threadId: threadTs,
      channelId: channel,
      workspaceId: teamId,
    });

    let taskId: string;
    let isNewTask = false;

    if (existingTask) {
      taskId = existingTask.id;
      if (existingTask.status !== "running") {
        await updateTask(taskId, { status: "running" });
      }
    } else {
      isNewTask = true;
      const newTask = await createTask({
        id: nanoid(),
        userId: linkedAccount.userId,
        title: cleanText.slice(0, 100) + (cleanText.length > 100 ? "..." : ""),
        status: "running",
        source: {
          provider: "slack",
          threadId: threadTs,
          channelId: channel,
          workspaceId: teamId,
        },
      });
      taskId = newTask.id;
    }

    // Acknowledge new tasks
    if (isNewTask) {
      const baseUrl = process.env.APP_URL ?? "https://openharness.dev";
      await thread.post(
        `Spinning up sandbox... Track here: ${baseUrl}/tasks/${taskId}`,
      );
    }

    // Process with AI agent (streaming)
    try {
      await processSlackMessage({
        taskId,
        userId: linkedAccount.userId,
        message: cleanText,
        thread,
        workspaceId: teamId,
        repo: repoParam,
      });
    } catch (error) {
      console.error("Error processing Slack message:", error);
      await thread.post(
        "I encountered an error while processing your request. Please try again.",
      );
    }
  });

  // Use Chat SDK's webhook handler (handles signature verification)
  return bot.webhooks.slack(
    new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body,
    }),
    {
      waitUntil: (task) => after(() => task),
    },
  );
}
