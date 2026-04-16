import { and, eq } from "drizzle-orm";
import type { InstallationRepository } from "@/lib/github/installation-repos";
import { searchInstallationRepositories } from "@/lib/github/installation-repo-search";
import { db } from "./client";
import { githubInstallationRepositories } from "./schema";

export interface CachedInstallationRepository {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  updated_at?: string;
}

function parseRepositoryUpdatedAt(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeRepository(row: {
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  repoUpdatedAt: Date | null;
}): CachedInstallationRepository {
  return {
    name: row.name,
    full_name: row.fullName,
    description: row.description,
    private: row.private,
    updated_at: row.repoUpdatedAt?.toISOString(),
  };
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}

export async function replaceUserInstallationRepositories(params: {
  userId: string;
  installationId: number;
  repositories: InstallationRepository[];
}): Promise<void> {
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .delete(githubInstallationRepositories)
      .where(
        and(
          eq(githubInstallationRepositories.userId, params.userId),
          eq(
            githubInstallationRepositories.installationId,
            params.installationId,
          ),
        ),
      );

    if (params.repositories.length === 0) {
      return;
    }

    const values = params.repositories.map((repo) => ({
      userId: params.userId,
      installationId: params.installationId,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      private: repo.private,
      repoUpdatedAt: parseRepositoryUpdatedAt(repo.updated_at),
      createdAt: now,
      updatedAt: now,
    }));

    for (const chunk of chunkValues(values, 500)) {
      await tx.insert(githubInstallationRepositories).values(chunk);
    }
  });
}

export async function searchUserInstallationRepositories(params: {
  userId: string;
  installationId: number;
  query?: string;
  limit?: number;
}): Promise<CachedInstallationRepository[]> {
  const rows = await db
    .select({
      name: githubInstallationRepositories.name,
      fullName: githubInstallationRepositories.fullName,
      description: githubInstallationRepositories.description,
      private: githubInstallationRepositories.private,
      repoUpdatedAt: githubInstallationRepositories.repoUpdatedAt,
    })
    .from(githubInstallationRepositories)
    .where(
      and(
        eq(githubInstallationRepositories.userId, params.userId),
        eq(
          githubInstallationRepositories.installationId,
          params.installationId,
        ),
      ),
    );

  return searchInstallationRepositories(
    rows.map((row) => serializeRepository(row)),
    {
      query: params.query,
      limit: params.limit,
    },
  );
}

export async function hasUserInstallationRepositoryCache(params: {
  userId: string;
  installationId: number;
}): Promise<boolean> {
  const [row] = await db
    .select({ name: githubInstallationRepositories.name })
    .from(githubInstallationRepositories)
    .where(
      and(
        eq(githubInstallationRepositories.userId, params.userId),
        eq(
          githubInstallationRepositories.installationId,
          params.installationId,
        ),
      ),
    )
    .limit(1);

  return !!row;
}
