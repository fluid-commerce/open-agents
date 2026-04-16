interface SearchableInstallationRepository {
  name: string;
  updated_at?: string | null;
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return 50;
  }

  return Math.max(1, Math.min(limit, 100));
}

function normalizeQuery(query?: string): string | null {
  const normalizedQuery = query?.trim().toLowerCase();
  return normalizedQuery ? normalizedQuery : null;
}

function getRepositoryNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function getRepositoryMatchRank(name: string, normalizedQuery: string): number {
  const normalizedName = name.toLowerCase();

  if (normalizedName === normalizedQuery) {
    return 4;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 3;
  }

  if (
    getRepositoryNameTokens(name).some((token) =>
      token.startsWith(normalizedQuery),
    )
  ) {
    return 2;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return 1;
  }

  return 0;
}

function getRepositoryUpdatedAtTimestamp(
  repo: SearchableInstallationRepository,
): number {
  if (!repo.updated_at) {
    return 0;
  }

  const parsed = Date.parse(repo.updated_at);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRepositoriesByRecentActivity(
  a: SearchableInstallationRepository,
  b: SearchableInstallationRepository,
): number {
  const updatedAtA = getRepositoryUpdatedAtTimestamp(a);
  const updatedAtB = getRepositoryUpdatedAtTimestamp(b);

  if (updatedAtA !== updatedAtB) {
    return updatedAtB - updatedAtA;
  }

  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

export function searchInstallationRepositories<
  T extends SearchableInstallationRepository,
>(
  repositories: T[],
  options: {
    query?: string;
    limit?: number;
  } = {},
): T[] {
  const normalizedQuery = normalizeQuery(options.query);
  const normalizedLimit = normalizeLimit(options.limit);

  if (!normalizedQuery) {
    return [...repositories]
      .sort(compareRepositoriesByRecentActivity)
      .slice(0, normalizedLimit);
  }

  return repositories
    .map((repo) => ({
      repo,
      matchRank: getRepositoryMatchRank(repo.name, normalizedQuery),
    }))
    .filter(({ matchRank }) => matchRank > 0)
    .sort((a, b) => {
      if (a.matchRank !== b.matchRank) {
        return b.matchRank - a.matchRank;
      }

      return compareRepositoriesByRecentActivity(a.repo, b.repo);
    })
    .slice(0, normalizedLimit)
    .map(({ repo }) => repo);
}
