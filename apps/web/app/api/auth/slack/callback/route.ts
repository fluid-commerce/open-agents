import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { upsertConnectedApp } from "@/lib/db/connected-apps";
import {
  createLinkedAccount,
  getLinkedAccountByProviderAndExternalId,
} from "@/lib/db/linked-accounts";

/**
 * Get the public URL for OAuth redirects
 * Uses APP_URL or NEXT_PUBLIC_APP_URL if set (for ngrok/production), otherwise falls back to request origin
 */
function getPublicUrl(req: NextRequest): string {
  // Prefer explicit app URL (needed for ngrok, tunnels, production)
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }
  // Check x-forwarded-host header (set by reverse proxies like ngrok)
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  // Fallback to request origin
  return req.nextUrl.origin;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: {
    id: string;
    name: string;
  };
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  const publicUrl = getPublicUrl(req);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("slack_auth_state")?.value;
  const userId = cookieStore.get("slack_auth_user_id")?.value;

  // Debug logging for OAuth state issues
  console.log("[Slack OAuth] State from URL:", state);
  console.log("[Slack OAuth] State from cookie:", storedState);
  console.log("[Slack OAuth] User ID from cookie:", userId);

  // Clean up cookies regardless of outcome
  cookieStore.delete("slack_auth_state");
  cookieStore.delete("slack_auth_user_id");

  // Handle user cancellation
  if (error) {
    const errorMessage =
      error === "access_denied"
        ? "Installation cancelled"
        : `Slack error: ${error}`;
    return Response.redirect(
      `${publicUrl}/settings/connectors?error=${encodeURIComponent(errorMessage)}`,
    );
  }

  // Validate state and code
  if (!code || !state || storedState !== state) {
    console.error("[Slack OAuth] State mismatch or missing");
    return Response.redirect(
      `${publicUrl}/settings/connectors?error=invalid_oauth_state`,
    );
  }

  if (!userId) {
    return Response.redirect(
      `${publicUrl}/settings/connectors?error=session_expired`,
    );
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return Response.redirect(
      `${publicUrl}/settings/connectors?error=slack_not_configured`,
    );
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: `${publicUrl}/api/auth/slack/callback`,
      }),
    });

    const data = (await tokenResponse.json()) as SlackOAuthResponse;

    if (!data.ok || !data.access_token || !data.team) {
      console.error("Slack OAuth error:", data.error);
      return Response.redirect(
        `${publicUrl}/settings/connectors?error=${encodeURIComponent(data.error ?? "oauth_failed")}`,
      );
    }

    // Store workspace-level bot installation
    await upsertConnectedApp({
      provider: "slack",
      workspaceId: data.team.id,
      workspaceName: data.team.name,
      botToken: data.access_token,
      installedByUserId: userId,
      metadata: {
        botUserId: data.bot_user_id,
        appId: data.app_id,
        scope: data.scope,
      },
    });

    // Link the installing user's Slack account if we have their authed_user info
    if (data.authed_user?.id) {
      // Check if already linked
      const existingLink = await getLinkedAccountByProviderAndExternalId(
        "slack",
        data.authed_user.id,
        data.team.id,
      );

      if (!existingLink) {
        await createLinkedAccount({
          userId: userId,
          provider: "slack",
          externalId: data.authed_user.id,
          workspaceId: data.team.id,
          metadata: {
            scope: data.authed_user.scope,
          },
        });
      }
    }

    return Response.redirect(
      `${publicUrl}/settings/connectors?success=slack_installed&workspace=${encodeURIComponent(data.team.name)}`,
    );
  } catch (err) {
    console.error("Slack OAuth callback error:", err);
    return Response.redirect(
      `${publicUrl}/settings/connectors?error=oauth_failed`,
    );
  }
}
