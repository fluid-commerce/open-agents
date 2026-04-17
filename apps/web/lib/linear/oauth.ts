import crypto from "crypto";

const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export const LINEAR_OAUTH_SCOPES = [
  "read",
  "write",
  "issues:create",
  "comments:create",
] as const;

// PKCE helpers — same pattern as lib/vercel/oauth.ts

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = crypto.createHash("sha256").update(verifier).digest();
  return digest.toString("base64url");
}

export function getLinearAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const searchParams = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: LINEAR_OAUTH_SCOPES.join(","),
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    prompt: "consent",
  });
  return `${LINEAR_AUTHORIZE_URL}?${searchParams.toString()}`;
}

interface LinearTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function exchangeLinearCode(params: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<LinearTokenResponse> {
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      code_verifier: params.codeVerifier,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      redirect_uri: params.redirectUri,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear token exchange failed: ${text}`);
  }

  return response.json() as Promise<LinearTokenResponse>;
}

export async function refreshLinearToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<LinearTokenResponse> {
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear token refresh failed: ${text}`);
  }

  return response.json() as Promise<LinearTokenResponse>;
}

export async function revokeLinearToken(params: {
  token: string;
  clientId: string;
  clientSecret: string;
}): Promise<void> {
  await fetch(LINEAR_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: params.token,
      client_id: params.clientId,
      client_secret: params.clientSecret,
    }),
  });
}

export interface LinearUserInfo {
  id: string;
  name: string;
  displayName: string;
  email: string;
  organizationId: string;
  organizationName: string;
  organizationUrlKey: string;
}

interface LinearGraphQLResponse {
  data?: {
    viewer?: {
      id?: string;
      name?: string;
      displayName?: string;
      email?: string;
      organization?: {
        id?: string;
        urlKey?: string;
        name?: string;
      };
    };
  };
  errors?: Array<{ message: string }>;
}

export async function getLinearUserInfo(
  accessToken: string,
): Promise<LinearUserInfo> {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      query:
        "query { viewer { id name displayName email organization { id urlKey name } } }",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Linear user info fetch failed: ${text}`);
  }

  const json = (await response.json()) as LinearGraphQLResponse;

  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `Linear GraphQL error: ${json.errors.map((e) => e.message).join(", ")}`,
    );
  }

  const viewer = json.data?.viewer;
  if (!viewer?.id || !viewer.organization) {
    throw new Error("Linear user info response missing required fields");
  }

  return {
    id: viewer.id,
    name: viewer.name ?? "",
    displayName: viewer.displayName ?? "",
    email: viewer.email ?? "",
    organizationId: viewer.organization.id ?? "",
    organizationName: viewer.organization.name ?? "",
    organizationUrlKey: viewer.organization.urlKey ?? "",
  };
}
