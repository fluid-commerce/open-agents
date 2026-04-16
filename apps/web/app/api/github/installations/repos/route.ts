import { NextRequest, NextResponse } from "next/server";
import {
  getInstallationByUserAndId,
  isInstallationRepoCacheStale,
  markInstallationRepoCacheSynced,
} from "@/lib/db/installations";
import {
  hasUserInstallationRepositoryCache,
  replaceUserInstallationRepositories,
  searchUserInstallationRepositories,
} from "@/lib/db/installation-repo-cache";
import { fetchUserInstallationRepositories } from "@/lib/github/installation-repos";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { getServerSession } from "@/lib/session/get-server-session";

function parseInstallationId(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const installationId = parseInstallationId(
    searchParams.get("installation_id"),
  );
  const query = searchParams.get("query")?.trim() || undefined;
  const refreshRequested = searchParams.get("refresh") === "1";
  const limitParam = searchParams.get("limit");
  const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const limit =
    typeof parsedLimit === "number" && Number.isFinite(parsedLimit)
      ? parsedLimit
      : undefined;

  if (!installationId) {
    return NextResponse.json(
      { error: "installation_id is required" },
      { status: 400 },
    );
  }

  const installation = await getInstallationByUserAndId(
    session.user.id,
    installationId,
  );
  if (!installation) {
    return NextResponse.json(
      { error: "Installation not found" },
      { status: 403 },
    );
  }

  const userToken = await getUserGitHubToken(session.user.id);
  if (!userToken) {
    return NextResponse.json(
      { error: "GitHub not connected" },
      { status: 401 },
    );
  }

  const shouldSync =
    refreshRequested || isInstallationRepoCacheStale(installation);

  if (shouldSync) {
    try {
      const repositories = await fetchUserInstallationRepositories({
        installationId,
        userToken,
        owner: installation.accountLogin,
      });

      await replaceUserInstallationRepositories({
        userId: session.user.id,
        installationId,
        repositories,
      });
      await markInstallationRepoCacheSynced(session.user.id, installationId);
    } catch (error) {
      const hasCachedRepositories = await hasUserInstallationRepositoryCache({
        userId: session.user.id,
        installationId,
      });
      const canServeCachedState =
        hasCachedRepositories || installation.repoCacheSyncedAt !== null;

      if (!canServeCachedState) {
        console.error("Failed to sync installation repositories:", error);
        return NextResponse.json(
          { error: "Failed to fetch repositories" },
          { status: 500 },
        );
      }

      console.error(
        "Failed to refresh installation repositories, serving stale cache:",
        error,
      );
    }
  }

  try {
    const repositories = await searchUserInstallationRepositories({
      userId: session.user.id,
      installationId,
      query,
      limit,
    });

    return NextResponse.json(repositories);
  } catch (error) {
    console.error(
      "Failed to read installation repositories from cache:",
      error,
    );
    return NextResponse.json(
      { error: "Failed to fetch repositories" },
      { status: 500 },
    );
  }
}
