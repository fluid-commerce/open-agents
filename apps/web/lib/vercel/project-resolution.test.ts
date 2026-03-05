import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

interface MockApiResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

// Track fetch calls
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let teamsApiResponse: MockApiResponse = {
  ok: true,
  status: 200,
  body: { teams: [] },
};
let projectApiResponsesByScope: Record<string, MockApiResponse> = {};

function toResponse(response: MockApiResponse): Response {
  return {
    ok: response.ok,
    status: response.status,
    text: async () => JSON.stringify(response.body),
    json: async () => response.body,
  } as Response;
}

async function withSuppressedConsoleError<T>(fn: () => Promise<T>): Promise<T> {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = originalConsoleError;
  }
}

function makeProjectsResponse(
  projects: Array<{
    id: string;
    name: string;
    accountId: string;
    link?: { type?: string; org?: string; repo?: string };
  }>,
): MockApiResponse {
  return {
    ok: true,
    status: 200,
    body: { projects },
  };
}

const EMPTY_PROJECTS_RESPONSE = makeProjectsResponse([]);

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (
  input: string | URL | Request,
  init?: RequestInit,
) => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  fetchCalls.push({ url, init });

  const parsed = new URL(url);

  if (parsed.pathname === "/v2/teams") {
    return toResponse(teamsApiResponse);
  }

  if (parsed.pathname === "/v10/projects") {
    const teamId = parsed.searchParams.get("teamId");
    const slug = parsed.searchParams.get("slug");
    const scopeKey = teamId ?? (slug ? `slug:${slug}` : "personal");
    const response =
      projectApiResponsesByScope[scopeKey] ?? EMPTY_PROJECTS_RESPONSE;
    return toResponse(response);
  }

  return toResponse({
    ok: false,
    status: 404,
    body: { error: "not_found" },
  });
}) as typeof globalThis.fetch;

const { resolveVercelProject } = await import("./project-resolution");

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("resolveVercelProject", () => {
  beforeEach(() => {
    fetchCalls = [];
    teamsApiResponse = { ok: true, status: 200, body: { teams: [] } };
    projectApiResponsesByScope = {};
  });

  test("returns project_unresolved when no projects exist in any scope", async () => {
    teamsApiResponse = {
      ok: true,
      status: 200,
      body: { teams: [{ id: "team_1", slug: "acme" }] },
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("project_unresolved");
    }

    // Should query: personal, slug:acme, team_1 (slug:acme dedupes with team_1 if slug matches)
    expect(fetchCalls[0]!.url).toContain("/v2/teams");
    // No repoUrl filter — projects are listed unfiltered
    const projectCalls = fetchCalls.filter((c) =>
      c.url.includes("/v10/projects"),
    );
    expect(projectCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of projectCalls) {
      expect(call.url).not.toContain("repoUrl=");
      expect(call.url).not.toContain("repo=");
    }
  });

  test("matches project by git link in personal scope", async () => {
    projectApiResponsesByScope.personal = makeProjectsResponse([
      {
        id: "prj_123",
        name: "my-app",
        accountId: "team_456",
        link: { type: "github", org: "acme", repo: "app" },
      },
      {
        id: "prj_other",
        name: "other-app",
        accountId: "team_456",
        link: { type: "github", org: "acme", repo: "other" },
      },
    ]);

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_123");
      expect(result.project.projectName).toBe("my-app");
      expect(result.project.orgId).toBe("team_456");
      expect(result.project.orgSlug).toBe("acme");
    }
  });

  test("matches case-insensitively on org and repo", async () => {
    projectApiResponsesByScope.personal = makeProjectsResponse([
      {
        id: "prj_ci",
        name: "my-app",
        accountId: "team_1",
        link: { type: "github", org: "Acme", repo: "APP" },
      },
    ]);

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_ci");
    }
  });

  test("ignores projects with non-github links", async () => {
    projectApiResponsesByScope.personal = makeProjectsResponse([
      {
        id: "prj_gl",
        name: "my-app",
        accountId: "team_1",
        link: { type: "gitlab", org: "acme", repo: "app" },
      },
    ]);

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("project_unresolved");
    }
  });

  test("resolves project from team scope when personal scope has no match", async () => {
    teamsApiResponse = {
      ok: true,
      status: 200,
      body: { teams: [{ id: "team_456", slug: "vercel-labs" }] },
    };
    projectApiResponsesByScope = {
      personal: EMPTY_PROJECTS_RESPONSE,
      team_456: makeProjectsResponse([
        {
          id: "prj_team",
          name: "open-harness",
          accountId: "team_456",
          link: { type: "github", org: "vercel-labs", repo: "open-harness" },
        },
      ]),
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "vercel-labs",
      repoName: "open-harness",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_team");
      expect(result.project.orgId).toBe("team_456");
      expect(result.project.orgSlug).toBe("vercel-labs");
    }
  });

  test("resolves project from owner slug scope without team membership", async () => {
    projectApiResponsesByScope = {
      personal: EMPTY_PROJECTS_RESPONSE,
      "slug:vercel-labs": makeProjectsResponse([
        {
          id: "prj_slug",
          name: "open-harness",
          accountId: "team_999",
          link: { type: "github", org: "vercel-labs", repo: "open-harness" },
        },
      ]),
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "vercel-labs",
      repoName: "open-harness",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_slug");
      expect(result.project.orgSlug).toBe("vercel-labs");
    }
  });

  test("dedupes duplicate project ids across all scopes", async () => {
    teamsApiResponse = {
      ok: true,
      status: 200,
      body: { teams: [{ id: "team_1", slug: "acme" }] },
    };

    const project = {
      id: "prj_shared",
      name: "app",
      accountId: "team_1",
      link: { type: "github", org: "acme", repo: "app" },
    };

    projectApiResponsesByScope = {
      personal: makeProjectsResponse([project]),
      "slug:acme": makeProjectsResponse([project]),
      team_1: makeProjectsResponse([project]),
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.projectId).toBe("prj_shared");
      expect(result.project.orgSlug).toBe("acme");
    }
  });

  test("returns project_ambiguous when multiple unique projects match", async () => {
    teamsApiResponse = {
      ok: true,
      status: 200,
      body: { teams: [{ id: "team_1", slug: "acme" }] },
    };
    projectApiResponsesByScope = {
      personal: makeProjectsResponse([
        {
          id: "prj_1",
          name: "app-1",
          accountId: "team_1",
          link: { type: "github", org: "acme", repo: "app" },
        },
      ]),
      team_1: makeProjectsResponse([
        {
          id: "prj_2",
          name: "app-2",
          accountId: "team_1",
          link: { type: "github", org: "acme", repo: "app" },
        },
      ]),
    };

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "acme",
      repoName: "app",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("project_ambiguous");
      expect(result.message).toContain("2");
    }
  });

  test("returns api_error when all project lookups fail", async () => {
    projectApiResponsesByScope = {
      personal: { ok: false, status: 403, body: { error: "forbidden" } },
      "slug:acme": { ok: false, status: 403, body: { error: "forbidden" } },
    };

    const result = await withSuppressedConsoleError(() =>
      resolveVercelProject({
        vercelToken: "tok_bad",
        repoOwner: "acme",
        repoName: "app",
      }),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("api_error");
      expect(result.message).toContain("403");
    }
  });

  test("returns api_error on network failure", async () => {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await withSuppressedConsoleError(() =>
        resolveVercelProject({
          vercelToken: "tok_test",
          repoOwner: "acme",
          repoName: "app",
        }),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("api_error");
        expect(result.message).toContain("network down");
      }
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  test("includes debug info with totalProjectsSeen", async () => {
    projectApiResponsesByScope.personal = makeProjectsResponse([
      {
        id: "prj_1",
        name: "app-a",
        accountId: "user_1",
        link: { type: "github", org: "user", repo: "other" },
      },
      {
        id: "prj_2",
        name: "app-b",
        accountId: "user_1",
        link: { type: "github", org: "user", repo: "target" },
      },
    ]);

    const result = await resolveVercelProject({
      vercelToken: "tok_test",
      repoOwner: "user",
      repoName: "target",
    });

    expect(result.ok).toBe(true);
    expect(result.debug).toBeDefined();
    expect(result.debug!.totalProjectsSeen).toBeGreaterThanOrEqual(2);
    expect(result.debug!.matchedProjectCount).toBe(1);
  });
});
