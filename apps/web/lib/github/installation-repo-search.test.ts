import { describe, expect, test } from "bun:test";

import { searchInstallationRepositories } from "./installation-repo-search";

function createRepo(name: string, updatedAt: string) {
  return {
    name,
    updated_at: updatedAt,
  };
}

describe("searchInstallationRepositories", () => {
  test("ranks exact matches above prefix and substring matches for short queries", () => {
    const repositories = [
      createRepo("ui-kit", "2024-05-03T00:00:00Z"),
      createRepo("circuit-ui", "2024-05-04T00:00:00Z"),
      createRepo("ui", "2024-05-01T00:00:00Z"),
      createRepo("build-ui-shell", "2024-05-05T00:00:00Z"),
    ];

    const results = searchInstallationRepositories(repositories, {
      query: "ui",
      limit: 10,
    });

    expect(results.map((repo) => repo.name)).toEqual([
      "ui",
      "ui-kit",
      "build-ui-shell",
      "circuit-ui",
    ]);
  });

  test("sorts by recent activity when no query is provided", () => {
    const repositories = [
      createRepo("docs", "2024-02-01T00:00:00Z"),
      createRepo("api", "2024-04-01T00:00:00Z"),
      createRepo("web", "2024-03-01T00:00:00Z"),
    ];

    const results = searchInstallationRepositories(repositories, { limit: 2 });

    expect(results.map((repo) => repo.name)).toEqual(["api", "web"]);
  });
});
