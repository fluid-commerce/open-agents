import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import { fetchUserInstallationRepositories } from "./installation-repos";

const originalFetch = globalThis.fetch;

function createRepository(name: string, updatedAt: string, owner = "acme") {
  return {
    name,
    full_name: `${owner}/${name}`,
    description: null,
    private: false,
    updated_at: updatedAt,
    owner: {
      login: owner,
    },
  };
}

function createPage(
  repositories: ReturnType<typeof createRepository>[],
  page: number,
  options: {
    fillPage?: boolean;
    fillerOwner?: string;
  } = {},
) {
  if (options.fillPage === false) {
    return repositories;
  }

  const fillerOwner = options.fillerOwner ?? "acme";

  return [
    ...repositories,
    ...Array.from({ length: 100 - repositories.length }, (_, index) =>
      createRepository(
        `filler-${page}-${index}`,
        `2023-01-${`${(index % 28) + 1}`.padStart(2, "0")}T00:00:00Z`,
        fillerOwner,
      ),
    ),
  ];
}

describe("fetchUserInstallationRepositories", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("fetches all pages and sorts repositories by recent activity", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const page = url.searchParams.get("page");

      expect(url.searchParams.get("per_page")).toBe("100");

      if (page === "1") {
        return Response.json({
          repositories: createPage(
            [
              createRepository("zeta", "2024-01-01T00:00:00Z"),
              createRepository("alpha", "2024-03-01T00:00:00Z"),
            ],
            1,
          ),
        });
      }

      return Response.json({
        repositories: createPage(
          [createRepository("omega", "2024-04-01T00:00:00Z")],
          2,
          { fillPage: false },
        ),
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const repos = await fetchUserInstallationRepositories({
      installationId: 123,
      userToken: "token",
      owner: "acme",
    });

    expect(repos.map((repo) => repo.name).slice(0, 3)).toEqual([
      "omega",
      "alpha",
      "zeta",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("filters repositories to the requested owner across pages", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const page = url.searchParams.get("page");

      if (page === "1") {
        return Response.json({
          repositories: createPage(
            [
              createRepository("docs", "2024-01-01T00:00:00Z", "acme"),
              createRepository("shared", "2024-02-01T00:00:00Z", "other"),
            ],
            1,
            { fillerOwner: "other" },
          ),
        });
      }

      return Response.json({
        repositories: createPage(
          [createRepository("api", "2024-03-01T00:00:00Z", "acme")],
          2,
          { fillPage: false },
        ),
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const repos = await fetchUserInstallationRepositories({
      installationId: 123,
      userToken: "token",
      owner: "acme",
    });

    expect(repos.map((repo) => repo.full_name)).toEqual([
      "acme/api",
      "acme/docs",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
