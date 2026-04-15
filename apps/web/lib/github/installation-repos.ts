import { z } from "zod";

const INSTALLATION_REPOS_PER_PAGE = 100;

const installationRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  clone_url: z.string().url(),
  updated_at: z.string(),
  language: z.string().nullable(),
  owner: z.object({
    login: z.string(),
  }),
});

const installationReposResponseSchema = z.object({
  repositories: z.array(installationRepoSchema),
});

const repositorySearchResponseSchema = z.object({
  items: z.array(installationRepoSchema),
});

export interface InstallationRepository {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  clone_url: string;
  updated_at: string;
  language: string | null;
}

interface ListUserInstallationRepositoriesOptions {
  installationId: number;
  userToken: string;
  owner?: string;
  query?: string;
  limit?: number;
  repositorySelection?: "all" | "selected";
}

function buildGitHubHeaders(userToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${userToken}`,
    Accept: "application/vnd.github.v3+json",
  };
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 8;
  }

  return Math.max(1, Math.min(limit, 100));
}

function compareRepositoriesByRecentActivity(
  a: Pick<InstallationRepository, "name" | "updated_at">,
  b: Pick<InstallationRepository, "name" | "updated_at">,
): number {
  const updatedAtA = Date.parse(a.updated_at);
  const updatedAtB = Date.parse(b.updated_at);
  const hasValidUpdatedAtA = Number.isFinite(updatedAtA);
  const hasValidUpdatedAtB = Number.isFinite(updatedAtB);

  if (hasValidUpdatedAtA && hasValidUpdatedAtB && updatedAtA !== updatedAtB) {
    return updatedAtB - updatedAtA;
  }

  if (hasValidUpdatedAtA !== hasValidUpdatedAtB) {
    return hasValidUpdatedAtA ? -1 : 1;
  }

  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

function createRepoMatcher(query?: string) {
  const queryFilter = query?.trim().toLowerCase();

  if (!queryFilter) {
    return () => true;
  }

  return (repo: z.infer<typeof installationRepoSchema>) => {
    const repoName = repo.name.toLowerCase();
    const fullName = repo.full_name.toLowerCase();

    return repoName.includes(queryFilter) || fullName.includes(queryFilter);
  };
}

async function fetchJson(endpoint: URL, userToken: string): Promise<unknown> {
  const response = await fetch(endpoint, {
    headers: buildGitHubHeaders(userToken),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub request failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function listInstallationRepositoriesPage(
  installationId: number,
  userToken: string,
  page: number,
  perPage = INSTALLATION_REPOS_PER_PAGE,
): Promise<z.infer<typeof installationRepoSchema>[]> {
  const endpoint = new URL(
    `https://api.github.com/user/installations/${installationId}/repositories`,
  );
  endpoint.searchParams.set("per_page", `${perPage}`);
  endpoint.searchParams.set("page", `${page}`);

  const json = await fetchJson(endpoint, userToken);
  const parsed = installationReposResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid GitHub user installation repositories response");
  }

  return parsed.data.repositories;
}

async function searchRepositories(
  query: string,
  userToken: string,
  owner?: string,
  limit?: number,
): Promise<z.infer<typeof installationRepoSchema>[]> {
  const endpoint = new URL("https://api.github.com/search/repositories");
  const searchTerms = [query.trim()];

  if (owner?.trim()) {
    searchTerms.push(`user:${owner.trim()}`);
  }

  endpoint.searchParams.set("q", searchTerms.join(" "));
  endpoint.searchParams.set("sort", "updated");
  endpoint.searchParams.set("order", "desc");
  endpoint.searchParams.set(
    "per_page",
    `${Math.min(limit ?? INSTALLATION_REPOS_PER_PAGE, INSTALLATION_REPOS_PER_PAGE)}`,
  );

  const json = await fetchJson(endpoint, userToken);
  const parsed = repositorySearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("Invalid GitHub repository search response");
  }

  return parsed.data.items;
}

/**
 * List repositories accessible to the user through a specific GitHub App
 * installation. Uses the user's OAuth token so GitHub computes the
 * intersection of repos the app can see and repos the user can see.
 */
export async function listUserInstallationRepositories({
  installationId,
  userToken,
  owner,
  query,
  limit,
  repositorySelection,
}: ListUserInstallationRepositoriesOptions): Promise<InstallationRepository[]> {
  const ownerFilter = owner?.trim().toLowerCase();
  const normalizedLimit = normalizeLimit(limit);
  const matchesQuery = createRepoMatcher(query);
  const searchQuery = query?.trim();
  const shouldUseInstallationListing =
    repositorySelection === "selected" || !searchQuery;

  const matchedRepos: z.infer<typeof installationRepoSchema>[] = [];
  const seenRepos = new Set<string>();

  if (shouldUseInstallationListing) {
    const repositories = await listInstallationRepositoriesPage(
      installationId,
      userToken,
      1,
      INSTALLATION_REPOS_PER_PAGE,
    );

    for (const repo of repositories) {
      const matchesOwner = ownerFilter
        ? repo.owner.login.toLowerCase() === ownerFilter
        : true;

      if (
        !matchesOwner ||
        !matchesQuery(repo) ||
        seenRepos.has(repo.full_name)
      ) {
        continue;
      }

      seenRepos.add(repo.full_name);
      matchedRepos.push(repo);
    }
  }

  if (!shouldUseInstallationListing && searchQuery) {
    const searchResults = await searchRepositories(
      searchQuery,
      userToken,
      owner,
      normalizedLimit,
    );

    for (const repo of searchResults) {
      const matchesOwner = ownerFilter
        ? repo.owner.login.toLowerCase() === ownerFilter
        : true;

      if (
        !matchesOwner ||
        !matchesQuery(repo) ||
        seenRepos.has(repo.full_name)
      ) {
        continue;
      }

      seenRepos.add(repo.full_name);
      matchedRepos.push(repo);
    }
  }

  return matchedRepos
    .sort(compareRepositoriesByRecentActivity)
    .slice(0, normalizedLimit)
    .map((repo) => ({
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      private: repo.private,
      clone_url: repo.clone_url,
      updated_at: repo.updated_at,
      language: repo.language,
    }));
}
