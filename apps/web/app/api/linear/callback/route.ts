import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { encrypt } from "@/lib/crypto";
import { upsertLinearAccount } from "@/lib/db/accounts";
import { exchangeLinearCode, getLinearUserInfo } from "@/lib/linear/oauth";
import { getServerSession } from "@/lib/session/get-server-session";

function clearLinearOauthCookies(store: Awaited<ReturnType<typeof cookies>>) {
  store.delete("linear_auth_state");
  store.delete("linear_auth_verifier");
  store.delete("linear_auth_redirect_to");
}

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();

  const storedState = cookieStore.get("linear_auth_state")?.value;
  const codeVerifier = cookieStore.get("linear_auth_verifier")?.value;
  const rawRedirectTo =
    cookieStore.get("linear_auth_redirect_to")?.value ??
    "/settings/connections";

  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/settings/connections";

  function redirectBack(params: Record<string, string>) {
    clearLinearOauthCookies(cookieStore);
    const url = new URL(storedRedirectTo, req.url);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    return Response.redirect(url);
  }

  if (error) {
    return redirectBack({ linear: "error", reason: error });
  }

  if (!code || !state || storedState !== state || !codeVerifier) {
    return redirectBack({ linear: "error", reason: "invalid_state" });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return redirectBack({ linear: "error", reason: "not_signed_in" });
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectBack({ linear: "error", reason: "not_configured" });
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/linear/callback`;
    const tokens = await exchangeLinearCode({
      code,
      codeVerifier,
      clientId,
      clientSecret,
      redirectUri,
    });
    const userInfo = await getLinearUserInfo(tokens.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await upsertLinearAccount({
      userId: session.user.id,
      externalUserId: userInfo.id,
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      scope: tokens.scope,
      username: userInfo.displayName,
      workspaceName: userInfo.organizationName,
      expiresAt: tokenExpiresAt,
    });

    return redirectBack({ linear: "connected" });
  } catch (err) {
    console.error("Linear OAuth callback error:", err);
    return redirectBack({ linear: "error", reason: "exchange_failed" });
  }
}
