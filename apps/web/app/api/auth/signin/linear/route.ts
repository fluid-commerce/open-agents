import crypto from "crypto";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  getLinearAuthorizationUrl,
} from "@/lib/linear/oauth";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) {
    return Response.redirect(new URL("/?error=linear_not_configured", req.url));
  }

  const session = await getServerSession();
  if (!session?.user) {
    const redirectAfter = `/api/auth/signin/linear?next=${encodeURIComponent(
      req.nextUrl.searchParams.get("next") ?? "/settings/connections",
    )}`;
    return Response.redirect(
      new URL(`/?next=${encodeURIComponent(redirectAfter)}`, req.url),
    );
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const store = await cookies();
  const redirectTo =
    req.nextUrl.searchParams.get("next") ?? "/settings/connections";

  const cookieOpts = {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax" as const,
  };

  store.set("linear_auth_state", state, cookieOpts);
  store.set("linear_auth_verifier", codeVerifier, cookieOpts);
  store.set("linear_auth_redirect_to", redirectTo, cookieOpts);

  const redirectUri = `${req.nextUrl.origin}/api/linear/callback`;
  const url = getLinearAuthorizationUrl({
    clientId,
    redirectUri,
    state,
    codeChallenge,
  });
  return Response.redirect(url);
}
