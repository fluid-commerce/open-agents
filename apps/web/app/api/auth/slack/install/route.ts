import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { generateState } from "arctic";
import { getSessionFromReq } from "@/lib/session/server";

// Slack OAuth scopes for bot installation
// See: https://api.slack.com/scopes
const SLACK_BOT_SCOPES = [
  "app_mentions:read", // Read @mentions of the bot
  "channels:history", // Read messages in public channels
  "channels:read", // View basic channel info
  "chat:write", // Post messages
  "groups:history", // Read messages in private channels the bot is in
  "groups:read", // View basic private channel info
  "im:history", // Read direct messages
  "im:read", // View basic DM info
  "im:write", // Start DMs with users
  "users:read", // View user info (for linking accounts)
].join(",");

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

export async function GET(req: NextRequest): Promise<Response> {
  // Require authentication before installing
  const session = await getSessionFromReq(req);
  if (!session?.user?.id) {
    // Redirect to login with return URL
    const returnUrl = encodeURIComponent("/api/auth/slack/install");
    return Response.redirect(
      new URL(`/api/auth/signin/github?next=${returnUrl}`, req.url),
    );
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const publicUrl = getPublicUrl(req);
  const redirectUri = `${publicUrl}/api/auth/slack/callback`;

  if (!clientId) {
    return Response.redirect(
      new URL("/settings/connectors?error=slack_not_configured", req.url),
    );
  }

  const state = generateState();
  const store = await cookies();

  // Store state for CSRF protection
  store.set("slack_auth_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10, // 10 minutes
    sameSite: "lax",
  });

  // Store the user ID who initiated the install
  store.set("slack_auth_user_id", session.user.id, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  // Build Slack OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SLACK_BOT_SCOPES,
    state: state,
  });

  return Response.redirect(
    `https://slack.com/oauth/v2/authorize?${params.toString()}`,
  );
}
