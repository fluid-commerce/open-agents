import { type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { generateState } from "arctic";

/**
 * Get the public URL for OAuth redirects
 */
function getPublicUrl(req: NextRequest): string {
  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    return appUrl.replace(/\/$/, "");
  }
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return req.nextUrl.origin;
}

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID;
  const publicUrl = getPublicUrl(req);
  const redirectUri = `${publicUrl}/api/auth/github/callback`;

  if (!clientId) {
    return Response.redirect(new URL("/?error=github_not_configured", req.url));
  }

  const state = generateState();
  const store = await cookies();
  const redirectTo = req.nextUrl.searchParams.get("next") ?? "/";

  store.set("github_auth_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  store.set("github_auth_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "repo,read:user,user:email",
    state: state,
  });

  return Response.redirect(
    `https://github.com/login/oauth/authorize?${params.toString()}`,
  );
}
