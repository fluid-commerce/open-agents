import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { Mock } from "bun:test";
import crypto from "crypto";

let mockFetchResponse: {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- bun mock typing requires it
type FetchMock = Mock<(...args: unknown[]) => unknown>;

function getFetchMock(): FetchMock {
  return globalThis.fetch as unknown as FetchMock;
}

beforeEach(() => {
  mockFetchResponse = {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => "",
  };

  globalThis.fetch = mock(
    async () => mockFetchResponse,
  ) as unknown as typeof fetch;
});

const {
  generateCodeVerifier,
  generateCodeChallenge,
  getLinearAuthorizationUrl,
  exchangeLinearCode,
  refreshLinearToken,
  revokeLinearToken,
  getLinearUserInfo,
  LINEAR_OAUTH_SCOPES,
} = await import("./oauth");

describe("generateCodeVerifier", () => {
  test("returns a base64url string", () => {
    const verifier = generateCodeVerifier();
    // base64url only contains [A-Za-z0-9_-]
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("returns a 43-character string (32 bytes in base64url)", () => {
    const verifier = generateCodeVerifier();
    // 32 bytes → ceil(32 * 4/3) = 43 characters in base64url (no padding)
    expect(verifier.length).toBe(43);
  });
});

describe("generateCodeChallenge", () => {
  test("returns a SHA256 digest as base64url", async () => {
    const verifier = "test-verifier";
    const challenge = await generateCodeChallenge(verifier);

    // Compute expected value manually
    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest()
      .toString("base64url");

    expect(challenge).toBe(expected);
    // base64url format check
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("getLinearAuthorizationUrl", () => {
  test("includes correct params", () => {
    const url = getLinearAuthorizationUrl({
      clientId: "my-client-id",
      redirectUri: "https://example.com/callback",
      state: "random-state",
      codeChallenge: "test-challenge",
    });

    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      "https://linear.app/oauth/authorize",
    );
    expect(parsed.searchParams.get("client_id")).toBe("my-client-id");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://example.com/callback",
    );
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toBe(
      LINEAR_OAUTH_SCOPES.join(","),
    );
    expect(parsed.searchParams.get("code_challenge")).toBe("test-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("prompt")).toBe("consent");
    expect(parsed.searchParams.get("state")).toBe("random-state");
  });
});

describe("exchangeLinearCode", () => {
  test("parses success response", async () => {
    const tokenResponse = {
      access_token: "lin_access_123",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "lin_refresh_456",
      scope: "read,write",
    };

    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => tokenResponse,
      text: async () => JSON.stringify(tokenResponse),
    };

    const result = await exchangeLinearCode({
      code: "auth-code",
      codeVerifier: "code-verifier",
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "https://example.com/callback",
    });

    expect(result).toEqual(tokenResponse);

    // Verify fetch was called with correct params
    const fetchMock = getFetchMock();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [callUrl, callInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(callUrl).toBe("https://api.linear.app/oauth/token");
    expect(callInit.method).toBe("POST");
    expect(callInit.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const body = new URLSearchParams(callInit.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("code-verifier");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
    expect(body.get("redirect_uri")).toBe("https://example.com/callback");
  });

  test("throws on non-ok response", async () => {
    mockFetchResponse = {
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_grant" }),
      text: async () => "invalid_grant",
    };

    expect(
      exchangeLinearCode({
        code: "bad-code",
        codeVerifier: "verifier",
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "https://example.com/callback",
      }),
    ).rejects.toThrow("Linear token exchange failed: invalid_grant");
  });
});

describe("refreshLinearToken", () => {
  test("parses success response", async () => {
    const tokenResponse = {
      access_token: "lin_new_access",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "lin_new_refresh",
      scope: "read,write",
    };

    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => tokenResponse,
      text: async () => JSON.stringify(tokenResponse),
    };

    const result = await refreshLinearToken({
      refreshToken: "lin_old_refresh",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(result).toEqual(tokenResponse);

    const fetchMock = getFetchMock();
    const [, callInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(callInit.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("lin_old_refresh");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
  });

  test("throws on non-ok response", async () => {
    mockFetchResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid_token" }),
      text: async () => "invalid_token",
    };

    expect(
      refreshLinearToken({
        refreshToken: "bad-token",
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).rejects.toThrow("Linear token refresh failed: invalid_token");
  });
});

describe("revokeLinearToken", () => {
  test("calls fetch with correct params", async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "",
    };

    await revokeLinearToken({
      token: "lin_access_to_revoke",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    const fetchMock = getFetchMock();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [callUrl, callInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(callUrl).toBe("https://api.linear.app/oauth/revoke");
    expect(callInit.method).toBe("POST");
    expect(callInit.headers).toEqual({
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const body = new URLSearchParams(callInit.body as string);
    expect(body.get("token")).toBe("lin_access_to_revoke");
    expect(body.get("client_id")).toBe("client-id");
    expect(body.get("client_secret")).toBe("client-secret");
  });
});

describe("getLinearUserInfo", () => {
  test("parses GraphQL response with viewer and organization", async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          viewer: {
            id: "user-1",
            name: "Test User",
            displayName: "Test",
            email: "test@example.com",
            organization: {
              id: "org-1",
              urlKey: "test-org",
              name: "Test Org",
            },
          },
        },
      }),
      text: async () => "",
    };

    const info = await getLinearUserInfo("lin_access_123");

    expect(info).toEqual({
      id: "user-1",
      name: "Test User",
      displayName: "Test",
      email: "test@example.com",
      organizationId: "org-1",
      organizationName: "Test Org",
      organizationUrlKey: "test-org",
    });

    // Verify correct Authorization header
    const fetchMock = getFetchMock();
    const [callUrl, callInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(callUrl).toBe("https://api.linear.app/graphql");
    expect((callInit.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer lin_access_123",
    );
  });

  test("throws on errors array", async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        errors: [
          { message: "Authentication required" },
          { message: "Scope not granted" },
        ],
      }),
      text: async () => "",
    };

    expect(getLinearUserInfo("bad-token")).rejects.toThrow(
      "Linear GraphQL error: Authentication required, Scope not granted",
    );
  });

  test("throws on missing viewer", async () => {
    mockFetchResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          viewer: null,
        },
      }),
      text: async () => "",
    };

    expect(getLinearUserInfo("token")).rejects.toThrow(
      "Linear user info response missing required fields",
    );
  });

  test("throws on non-ok HTTP response", async () => {
    mockFetchResponse = {
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "Internal Server Error",
    };

    expect(getLinearUserInfo("token")).rejects.toThrow(
      "Linear user info fetch failed: Internal Server Error",
    );
  });
});
