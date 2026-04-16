import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

type AuthSession = {
  user: {
    id: string;
  };
} | null;

type InstallationRecord = {
  installationId: number;
  accountLogin: string;
  repoCacheSyncedAt: Date | null;
  repoCacheStaleAt: Date | null;
} | null;

let authSession: AuthSession;
let installation: InstallationRecord;
let userToken: string | null;
let cachedRepos = [{ name: "ui", full_name: "acme/ui", private: false }];
let fetchedRepos = [
  {
    name: "ui",
    full_name: "acme/ui",
    description: null,
    private: false,
    updated_at: "2024-05-01T00:00:00Z",
  },
];
let hasCache = false;

const fetchUserInstallationRepositoriesMock = mock(async () => fetchedRepos);
const replaceUserInstallationRepositoriesMock = mock(async () => {});
const searchUserInstallationRepositoriesMock = mock(async () => cachedRepos);
const hasUserInstallationRepositoryCacheMock = mock(async () => hasCache);
const markInstallationRepoCacheSyncedMock = mock(async () => 1);

mock.module("@/lib/session/get-server-session", () => ({
  getServerSession: async () => authSession,
}));

mock.module("@/lib/db/installations", () => ({
  getInstallationByUserAndId: async () => installation,
  isInstallationRepoCacheStale: (value: {
    repoCacheSyncedAt: Date | null;
    repoCacheStaleAt: Date | null;
  }) => !value.repoCacheSyncedAt,
  markInstallationRepoCacheSynced: markInstallationRepoCacheSyncedMock,
}));

mock.module("@/lib/db/installation-repo-cache", () => ({
  replaceUserInstallationRepositories: replaceUserInstallationRepositoriesMock,
  searchUserInstallationRepositories: searchUserInstallationRepositoriesMock,
  hasUserInstallationRepositoryCache: hasUserInstallationRepositoryCacheMock,
}));

mock.module("@/lib/github/installation-repos", () => ({
  fetchUserInstallationRepositories: fetchUserInstallationRepositoriesMock,
}));

mock.module("@/lib/github/user-token", () => ({
  getUserGitHubToken: async () => userToken,
}));

const routeModulePromise = import("./route");

describe("GET /api/github/installations/repos", () => {
  beforeEach(() => {
    authSession = { user: { id: "user-1" } };
    installation = {
      installationId: 123,
      accountLogin: "acme",
      repoCacheSyncedAt: null,
      repoCacheStaleAt: new Date("2024-05-01T00:00:00Z"),
    };
    userToken = "ghu_user";
    cachedRepos = [{ name: "ui", full_name: "acme/ui", private: false }];
    fetchedRepos = [
      {
        name: "ui",
        full_name: "acme/ui",
        description: null,
        private: false,
        updated_at: "2024-05-01T00:00:00Z",
      },
    ];
    hasCache = false;
    fetchUserInstallationRepositoriesMock.mockClear();
    replaceUserInstallationRepositoriesMock.mockClear();
    searchUserInstallationRepositoriesMock.mockClear();
    hasUserInstallationRepositoryCacheMock.mockClear();
    markInstallationRepoCacheSyncedMock.mockClear();
  });

  test("returns 401 when unauthenticated", async () => {
    authSession = null;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/installations/repos?installation_id=123",
      ) as never,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  test("returns 403 when the installation does not belong to the user", async () => {
    installation = null;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/installations/repos?installation_id=123",
      ) as never,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Installation not found" });
  });

  test("syncs stale cache before returning repositories", async () => {
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/installations/repos?installation_id=123&query=ui&limit=25",
      ) as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cachedRepos);
    expect(fetchUserInstallationRepositoriesMock).toHaveBeenCalledWith({
      installationId: 123,
      userToken: "ghu_user",
      owner: "acme",
    });
    expect(replaceUserInstallationRepositoriesMock).toHaveBeenCalledWith({
      userId: "user-1",
      installationId: 123,
      repositories: fetchedRepos,
    });
    expect(markInstallationRepoCacheSyncedMock).toHaveBeenCalledWith(
      "user-1",
      123,
    );
    expect(searchUserInstallationRepositoriesMock).toHaveBeenCalledWith({
      userId: "user-1",
      installationId: 123,
      query: "ui",
      limit: 25,
    });
  });

  test("serves stale cache when refresh sync fails but cache exists", async () => {
    fetchUserInstallationRepositoriesMock.mockImplementationOnce(async () => {
      throw new Error("GitHub unavailable");
    });
    hasCache = true;
    const { GET } = await routeModulePromise;

    const response = await GET(
      new Request(
        "http://localhost/api/github/installations/repos?installation_id=123&refresh=1",
      ) as never,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(cachedRepos);
    expect(hasUserInstallationRepositoryCacheMock).toHaveBeenCalledWith({
      userId: "user-1",
      installationId: 123,
    });
    expect(searchUserInstallationRepositoriesMock).toHaveBeenCalledTimes(1);
  });
});
