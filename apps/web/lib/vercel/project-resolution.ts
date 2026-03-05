import "server-only";

const VERCEL_API_BASE = "https://api.vercel.com";
const PROJECTS_PER_PAGE = 100;
const MAX_PAGES_PER_SCOPE = 5;

export interface VercelProjectInfo {
  projectId: string;
  projectName: string;
  orgId: string;
  orgSlug?: string;
}

export type ResolutionFailureReason =
  | "no_vercel_auth"
  | "no_repo_context"
  | "project_unresolved"
  | "project_ambiguous"
  | "api_error";

export interface ResolutionDebugInfo {
  scopesQueried: number;
  scopesSucceeded: number;
  scopesFailed: number;
  teamCount: number;
  totalProjectsSeen: number;
  matchedProjectCount: number;
}

export type ProjectResolutionResult =
  | { ok: true; project: VercelProjectInfo; debug?: ResolutionDebugInfo }
  | {
      ok: false;
      reason: ResolutionFailureReason;
      message?: string;
      debug?: ResolutionDebugInfo;
    };

interface VercelProjectResponse {
  id: string;
  name: string;
  accountId: string;
  link?: {
    type?: string;
    org?: string;
    repo?: string;
    repoId?: number;
  };
}

interface VercelProjectsListResponse {
  projects?: VercelProjectResponse[];
  pagination?: {
    count?: number;
    next?: number | string | null;
  };
}

interface VercelTeamResponse {
  id: string;
  slug?: string;
}

interface VercelTeamsListResponse {
  teams?: VercelTeamResponse[];
}

interface ProjectScope {
  teamId?: string;
  slug?: string;
  teamSlug?: string;
}

type ScopedProjectResult =
  | { ok: true; projects: VercelProjectResponse[]; totalSeen: number }
  | { ok: false; status: number; message: string };

async function listVercelTeams(
  vercelToken: string,
): Promise<VercelTeamResponse[]> {
  const response = await fetch(`${VERCEL_API_BASE}/v2/teams`, {
    headers: { Authorization: `Bearer ${vercelToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Vercel] Team list API error (${response.status}): ${text}`);
    return [];
  }

  const data = (await response.json()) as VercelTeamsListResponse;
  return data.teams ?? [];
}

/**
 * Check whether a Vercel project's git link matches the target GitHub repo.
 */
function projectMatchesRepo(
  project: VercelProjectResponse,
  repoOwner: string,
  repoName: string,
): boolean {
  const link = project.link;
  if (!link) return false;
  if (link.type !== "github") return false;

  const orgMatch = link.org?.toLowerCase() === repoOwner.toLowerCase();
  const repoMatch = link.repo?.toLowerCase() === repoName.toLowerCase();

  return orgMatch && repoMatch;
}

/**
 * Fetch all projects for a given scope and filter client-side by repo link.
 * Paginates through results to handle accounts with many projects.
 */
async function fetchProjectsForScope(params: {
  vercelToken: string;
  repoOwner: string;
  repoName: string;
  teamId?: string;
  slug?: string;
}): Promise<ScopedProjectResult> {
  const { vercelToken, repoOwner, repoName, teamId, slug } = params;

  const matched: VercelProjectResponse[] = [];
  let totalSeen = 0;
  let cursor: string | number | null | undefined = undefined;

  for (let page = 0; page < MAX_PAGES_PER_SCOPE; page++) {
    const url = new URL(`${VERCEL_API_BASE}/v10/projects`);
    url.searchParams.set("limit", String(PROJECTS_PER_PAGE));
    if (teamId) {
      url.searchParams.set("teamId", teamId);
    }
    if (slug) {
      url.searchParams.set("slug", slug);
    }
    if (cursor != null) {
      url.searchParams.set("from", String(cursor));
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });

    if (!response.ok) {
      const message = await response.text();
      return { ok: false, status: response.status, message };
    }

    const data = (await response.json()) as VercelProjectsListResponse;
    const projects = data.projects ?? [];
    totalSeen += projects.length;

    for (const project of projects) {
      if (projectMatchesRepo(project, repoOwner, repoName)) {
        matched.push(project);
      }
    }

    // Stop if we found a match (no need to keep paginating) or no more pages
    if (matched.length > 0) break;
    if (!data.pagination?.next) break;
    cursor = data.pagination.next;
  }

  return { ok: true, projects: matched, totalSeen };
}

/**
 * Resolve a Vercel project from a GitHub repository.
 *
 * Lists all projects in personal scope, owner slug scope, and every
 * accessible team scope, then matches client-side against the project's
 * git link (link.org + link.repo). This avoids dependency on the API's
 * server-side repo filter format.
 */
export async function resolveVercelProject(params: {
  vercelToken: string;
  repoOwner: string;
  repoName: string;
}): Promise<ProjectResolutionResult> {
  const { vercelToken, repoOwner, repoName } = params;

  try {
    const teams = await listVercelTeams(vercelToken);

    const scopes: ProjectScope[] = [];
    const seenScopes = new Set<string>();

    const addScope = (scope: ProjectScope) => {
      const key = scope.teamId
        ? `team:${scope.teamId}`
        : scope.slug
          ? `slug:${scope.slug}`
          : "personal";
      if (seenScopes.has(key)) {
        return;
      }
      seenScopes.add(key);
      scopes.push(scope);
    };

    addScope({});
    addScope({ slug: repoOwner, teamSlug: repoOwner });
    for (const team of teams) {
      addScope({ teamId: team.id, teamSlug: team.slug });
    }

    const projectsById = new Map<
      string,
      { project: VercelProjectResponse; teamSlug?: string }
    >();

    let hadSuccessfulQuery = false;
    let scopesSucceeded = 0;
    let scopesFailed = 0;
    let totalProjectsSeen = 0;
    let lastErrorStatus: number | null = null;

    for (const scope of scopes) {
      const result = await fetchProjectsForScope({
        vercelToken,
        repoOwner,
        repoName,
        teamId: scope.teamId,
        slug: scope.slug,
      });

      if (!result.ok) {
        scopesFailed++;
        lastErrorStatus = result.status;
        const scopeLabel = scope.teamId
          ? `teamId=${scope.teamId}`
          : scope.slug
            ? `slug=${scope.slug}`
            : "personal scope";
        console.error(
          `[Vercel] Project resolution API error (${result.status}) for ${scopeLabel}: ${result.message}`,
        );
        continue;
      }

      hadSuccessfulQuery = true;
      scopesSucceeded++;
      totalProjectsSeen += result.totalSeen;

      for (const project of result.projects) {
        const existing = projectsById.get(project.id);
        if (!existing) {
          projectsById.set(project.id, {
            project,
            teamSlug: scope.teamSlug,
          });
          continue;
        }

        if (!existing.teamSlug && scope.teamSlug) {
          existing.teamSlug = scope.teamSlug;
        }
      }
    }

    const debug: ResolutionDebugInfo = {
      scopesQueried: scopes.length,
      scopesSucceeded,
      scopesFailed,
      teamCount: teams.length,
      totalProjectsSeen,
      matchedProjectCount: projectsById.size,
    };

    if (projectsById.size === 0) {
      if (!hadSuccessfulQuery && lastErrorStatus !== null) {
        return {
          ok: false,
          reason: "api_error",
          message: `Vercel API returned ${lastErrorStatus}`,
          debug,
        };
      }

      return {
        ok: false,
        reason: "project_unresolved",
        message: `No Vercel project found for ${repoOwner}/${repoName}`,
        debug,
      };
    }

    if (projectsById.size > 1) {
      return {
        ok: false,
        reason: "project_ambiguous",
        message: `Found ${projectsById.size} Vercel projects for ${repoOwner}/${repoName}`,
        debug,
      };
    }

    const resolved = projectsById.values().next().value;
    if (!resolved) {
      return {
        ok: false,
        reason: "project_unresolved",
        message: `No Vercel project found for ${repoOwner}/${repoName}`,
        debug,
      };
    }

    return {
      ok: true,
      project: {
        projectId: resolved.project.id,
        projectName: resolved.project.name,
        orgId: resolved.project.accountId,
        orgSlug: resolved.project.link?.org ?? resolved.teamSlug,
      },
      debug,
    };
  } catch (error) {
    console.error("[Vercel] Project resolution failed:", error);
    return {
      ok: false,
      reason: "api_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
