import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  listUserInstallationRepositories,
  type InstallationRepository,
} from "./installation-repos";

const originalFetch = global.fetch;

function createRepo(
  overrides: Partial<InstallationRepository> & {
    name: string;
    full_name: string;
    updated_at: string;
  },
): InstallationRepository & { owner: { login: string } } {
  return {
    name: overrides.name,
    full_name: overrides.full_name,
    description: overrides.description ?? null,
    private: overrides.private ?? true,
    clone_url:
      overrides.clone_url ?? `https://github.com/${overrides.full_name}.git`,
    updated_at: overrides.updated_at,
    language: overrides.language ?? null,
    owner: {
      login: overrides.full_name.split("/")[0] ?? "octocat",
    },
  };
}

describe("listUserInstallationRepositories", () => {
  beforeEach(() => {
    const fetchMock = mock(async (input: string | URL) => {
      const url = input instanceof URL ? input : new URL(input);

      if (url.pathname === "/user/installations/123/repositories") {
        return Response.json({
          repositories:
            url.searchParams.get("page") === "1"
              ? [
                  createRepo({
                    name: "open-agents-app",
                    full_name: "open-agents/open-agents-app",
                    updated_at: "2025-01-01T00:00:00Z",
                  }),
                  createRepo({
                    name: "platform",
                    full_name: "open-agents/platform",
                    updated_at: "2024-01-01T00:00:00Z",
                  }),
                ]
              : [],
        });
      }

      if (url.pathname === "/search/repositories") {
        return Response.json({
          items: [
            createRepo({
              name: "open-agents-app",
              full_name: "open-agents/open-agents-app",
              updated_at: "2025-01-01T00:00:00Z",
            }),
            createRepo({
              name: "open-agents-uninstalled",
              full_name: "open-agents/open-agents-uninstalled",
              updated_at: "2026-01-01T00:00:00Z",
            }),
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("uses GitHub search directly for full-access installations", async () => {
    const repos = await listUserInstallationRepositories({
      installationId: 123,
      userToken: "token",
      owner: "open-agents",
      query: "open-agents",
      limit: 25,
      repositorySelection: "all",
    });

    expect(repos).toEqual([
      {
        name: "open-agents-uninstalled",
        full_name: "open-agents/open-agents-uninstalled",
        description: null,
        private: true,
        clone_url: "https://github.com/open-agents/open-agents-uninstalled.git",
        updated_at: "2026-01-01T00:00:00Z",
        language: null,
      },
      {
        name: "open-agents-app",
        full_name: "open-agents/open-agents-app",
        description: null,
        private: true,
        clone_url: "https://github.com/open-agents/open-agents-app.git",
        updated_at: "2025-01-01T00:00:00Z",
        language: null,
      },
    ]);
  });

  test("uses a single installation repositories page for selected-repo installations", async () => {
    const repos = await listUserInstallationRepositories({
      installationId: 123,
      userToken: "token",
      owner: "open-agents",
      query: "open-agents-app",
      limit: 25,
      repositorySelection: "selected",
    });

    expect(repos).toEqual([
      {
        name: "open-agents-app",
        full_name: "open-agents/open-agents-app",
        description: null,
        private: true,
        clone_url: "https://github.com/open-agents/open-agents-app.git",
        updated_at: "2025-01-01T00:00:00Z",
        language: null,
      },
    ]);
  });

  test("returns installation repos without search when query is empty", async () => {
    const repos = await listUserInstallationRepositories({
      installationId: 123,
      userToken: "token",
      owner: "open-agents",
      limit: 1,
      repositorySelection: "all",
    });

    expect(repos).toEqual([
      {
        name: "open-agents-app",
        full_name: "open-agents/open-agents-app",
        description: null,
        private: true,
        clone_url: "https://github.com/open-agents/open-agents-app.git",
        updated_at: "2025-01-01T00:00:00Z",
        language: null,
      },
    ]);
  });
});
