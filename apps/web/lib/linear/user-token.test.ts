import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test";

mock.module("server-only", () => ({}));

// --- Mock state ---

let mockAccount: {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  username: string;
  externalUserId: string;
  workspaceName: string | null;
} | null = null;

let updateTokensCalls: Array<{
  userId: string;
  data: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
  };
}> = [];
let updateTokensError: Error | null = null;

let mockRefreshResult: {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
} | null = null;
let mockRefreshError: Error | null = null;

mock.module("@/lib/db/accounts", () => ({
  getLinearAccount: async (_userId: string) => mockAccount,
  updateLinearAccountTokens: async (
    userId: string,
    data: { accessToken: string; refreshToken?: string; expiresAt?: Date },
  ) => {
    updateTokensCalls.push({ userId, data });
    if (updateTokensError) {
      throw updateTokensError;
    }
  },
}));

mock.module("@/lib/crypto", () => ({
  decrypt: (value: string) => `decrypted:${value}`,
  encrypt: (value: string) => `encrypted:${value}`,
}));

mock.module("./oauth", () => ({
  refreshLinearToken: async () => {
    if (mockRefreshError) {
      throw mockRefreshError;
    }
    return mockRefreshResult;
  },
}));

const { getUserLinearToken } = await import("./user-token");

const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  mockAccount = null;
  updateTokensCalls = [];
  updateTokensError = null;
  mockRefreshResult = null;
  mockRefreshError = null;
  consoleErrorSpy.mockClear();

  // Restore env vars
  process.env.LINEAR_CLIENT_ID = "test-client-id";
  process.env.LINEAR_CLIENT_SECRET = "test-client-secret";
});

describe("getUserLinearToken", () => {
  test("returns null when no account exists", async () => {
    mockAccount = null;

    const token = await getUserLinearToken("user-1");

    expect(token).toBeNull();
  });

  test("returns decrypted token when not expired", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    mockAccount = {
      accessToken: "enc-access-token",
      refreshToken: "enc-refresh-token",
      expiresAt: futureDate,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: "Test Workspace",
    };

    const token = await getUserLinearToken("user-1");

    expect(token).toBe("decrypted:enc-access-token");
  });

  test("returns decrypted token when expiresAt is null (no expiration)", async () => {
    mockAccount = {
      accessToken: "enc-access-token",
      refreshToken: null,
      expiresAt: null,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    const token = await getUserLinearToken("user-1");

    expect(token).toBe("decrypted:enc-access-token");
  });

  test("refreshes and returns new token when expired (within 5-min buffer)", async () => {
    // Token expires 3 minutes from now (within the 5-minute buffer)
    const almostExpired = new Date(Date.now() + 3 * 60 * 1000);
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: "enc-refresh-token",
      expiresAt: almostExpired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    mockRefreshResult = {
      access_token: "new-access-token",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "new-refresh-token",
      scope: "read,write",
    };

    const token = await getUserLinearToken("user-1");

    expect(token).toBe("new-access-token");
    expect(updateTokensCalls).toHaveLength(1);
    expect(updateTokensCalls[0]?.userId).toBe("user-1");
    expect(updateTokensCalls[0]?.data.accessToken).toBe(
      "encrypted:new-access-token",
    );
    expect(updateTokensCalls[0]?.data.refreshToken).toBe(
      "encrypted:new-refresh-token",
    );
  });

  test("returns null when expired but no refresh token available", async () => {
    const expired = new Date(Date.now() - 60 * 1000); // already expired
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: null,
      expiresAt: expired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    const token = await getUserLinearToken("user-1");

    expect(token).toBeNull();
  });

  test("returns null when LINEAR_CLIENT_ID not set", async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: "enc-refresh",
      expiresAt: expired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    delete process.env.LINEAR_CLIENT_ID;

    const token = await getUserLinearToken("user-1");

    expect(token).toBeNull();
  });

  test("returns null when LINEAR_CLIENT_SECRET not set", async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: "enc-refresh",
      expiresAt: expired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    delete process.env.LINEAR_CLIENT_SECRET;

    const token = await getUserLinearToken("user-1");

    expect(token).toBeNull();
  });

  test("returns null on refresh failure", async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: "enc-refresh",
      expiresAt: expired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    mockRefreshError = new Error("token revoked");

    const token = await getUserLinearToken("user-1");

    expect(token).toBeNull();
  });

  test("persists refreshed tokens", async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: "enc-refresh",
      expiresAt: expired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    mockRefreshResult = {
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 7200,
      refresh_token: "new-refresh",
      scope: "read,write",
    };

    await getUserLinearToken("user-1");

    expect(updateTokensCalls).toHaveLength(1);
    expect(updateTokensCalls[0]?.data.accessToken).toBe("encrypted:new-access");
    expect(updateTokensCalls[0]?.data.refreshToken).toBe(
      "encrypted:new-refresh",
    );
    expect(updateTokensCalls[0]?.data.expiresAt).toBeInstanceOf(Date);
  });

  test("still returns token even if persistence fails", async () => {
    const expired = new Date(Date.now() - 60 * 1000);
    mockAccount = {
      accessToken: "enc-old-access",
      refreshToken: "enc-refresh",
      expiresAt: expired,
      username: "testuser",
      externalUserId: "ext-1",
      workspaceName: null,
    };

    mockRefreshResult = {
      access_token: "new-access",
      token_type: "Bearer",
      expires_in: 7200,
      refresh_token: "new-refresh",
      scope: "read,write",
    };

    updateTokensError = new Error("DB connection failed");

    const token = await getUserLinearToken("user-1");

    // Should still return the new token despite persistence failure
    expect(token).toBe("new-access");
    expect(updateTokensCalls).toHaveLength(1);
  });
});
