/**
 * Slack API helper functions
 */

interface SlackPostResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

/**
 * Post a message to Slack
 */
export async function postSlackMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string,
): Promise<{ success: boolean; ts?: string; error?: string }> {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text,
        ...(threadTs && { thread_ts: threadTs }),
      }),
    });

    const data = (await response.json()) as SlackPostResponse;
    if (!data.ok) {
      console.error("Slack postMessage error:", data.error);
      return { success: false, error: data.error };
    }
    return { success: true, ts: data.ts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to post Slack message:", message);
    return { success: false, error: message };
  }
}

/**
 * Update an existing Slack message
 */
export async function updateSlackMessage(
  botToken: string,
  channel: string,
  ts: string,
  text: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("https://slack.com/api/chat.update", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        ts,
        text,
      }),
    });

    const data = (await response.json()) as SlackPostResponse;
    if (!data.ok) {
      console.error("Slack chat.update error:", data.error);
      return { success: false, error: data.error };
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to update Slack message:", message);
    return { success: false, error: message };
  }
}
