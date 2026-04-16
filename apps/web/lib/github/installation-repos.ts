import { z } from "zod";

const installationRepoSchema = z.object({
  name: z.string(),
  full_name: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  updated_at: z.string(),
  owner: z.object({
    login: z.string(),
  }),
});

const installationReposResponseSchema = z.object({
  repositories: z.array(installationRepoSchema),
});

export interface InstallationRepository {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  updated_at: string;
}

interface FetchUserInstallationRepositoriesOptions {
  installationId: number;
  userToken: string;
  owner?: string;
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

export async function fetchUserInstallationRepositories({
  installationId,
  userToken,
  owner,
}: FetchUserInstallationRepositoriesOptions): Promise<
  InstallationRepository[]
> {
  const ownerFilter = owner?.trim().toLowerCase();
  const repositories: InstallationRepository[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const endpoint = new URL(
      `https://api.github.com/user/installations/${installationId}/repositories`,
    );
    endpoint.searchParams.set("per_page", `${perPage}`);
    endpoint.searchParams.set("page", `${page}`);

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${userToken}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to fetch user installation repositories: ${response.status} ${body}`,
      );
    }

    const json = await response.json();
    const parsed = installationReposResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error("Invalid GitHub user installation repositories response");
    }

    if (parsed.data.repositories.length === 0) {
      break;
    }

    repositories.push(
      ...parsed.data.repositories
        .filter((repo) => {
          if (!ownerFilter) {
            return true;
          }

          return repo.owner.login.toLowerCase() === ownerFilter;
        })
        .map((repo) => ({
          name: repo.name,
          full_name: repo.full_name,
          description: repo.description,
          private: repo.private,
          updated_at: repo.updated_at,
        })),
    );

    if (parsed.data.repositories.length < perPage) {
      break;
    }

    page += 1;
  }

  repositories.sort(compareRepositoriesByRecentActivity);

  return repositories;
}
