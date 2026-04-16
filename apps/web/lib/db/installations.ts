import { and, asc, eq, inArray, notInArray, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./client";
import {
  githubInstallationRepositories,
  type GitHubInstallation,
  githubInstallations,
  type NewGitHubInstallation,
} from "./schema";

export interface UpsertInstallationInput {
  userId: string;
  installationId: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  installationUrl?: string | null;
}

function shouldMarkRepoCacheStale(
  existing: {
    installationId: number;
    accountLogin: string;
    repositorySelection: "all" | "selected";
  },
  next: UpsertInstallationInput,
): boolean {
  return (
    existing.installationId !== next.installationId ||
    existing.accountLogin !== next.accountLogin ||
    existing.repositorySelection !== next.repositorySelection
  );
}

export function isInstallationRepoCacheStale(installation: {
  repoCacheSyncedAt: Date | null;
  repoCacheStaleAt: Date | null;
}): boolean {
  if (!installation.repoCacheSyncedAt) {
    return true;
  }

  if (!installation.repoCacheStaleAt) {
    return false;
  }

  return installation.repoCacheStaleAt > installation.repoCacheSyncedAt;
}

export async function upsertInstallation(
  data: UpsertInstallationInput,
): Promise<GitHubInstallation> {
  const existing = await db
    .select({
      id: githubInstallations.id,
      installationId: githubInstallations.installationId,
      accountLogin: githubInstallations.accountLogin,
      repositorySelection: githubInstallations.repositorySelection,
      repoCacheSyncedAt: githubInstallations.repoCacheSyncedAt,
      repoCacheStaleAt: githubInstallations.repoCacheStaleAt,
    })
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, data.userId),
        or(
          eq(githubInstallations.installationId, data.installationId),
          eq(githubInstallations.accountLogin, data.accountLogin),
        ),
      ),
    )
    .limit(1);

  const now = new Date();

  if (existing[0]) {
    const markRepoCacheStale = shouldMarkRepoCacheStale(existing[0], data);
    const [updated] = await db
      .update(githubInstallations)
      .set({
        installationId: data.installationId,
        accountLogin: data.accountLogin,
        accountType: data.accountType,
        repositorySelection: data.repositorySelection,
        installationUrl: data.installationUrl ?? null,
        repoCacheSyncedAt: existing[0].repoCacheSyncedAt,
        repoCacheStaleAt: markRepoCacheStale
          ? now
          : existing[0].repoCacheStaleAt,
        updatedAt: now,
      })
      .where(eq(githubInstallations.id, existing[0].id))
      .returning();

    if (!updated) {
      throw new Error("Failed to update GitHub installation");
    }

    return updated;
  }

  const installation: NewGitHubInstallation = {
    id: nanoid(),
    userId: data.userId,
    installationId: data.installationId,
    accountLogin: data.accountLogin,
    accountType: data.accountType,
    repositorySelection: data.repositorySelection,
    installationUrl: data.installationUrl ?? null,
    repoCacheSyncedAt: null,
    repoCacheStaleAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const [created] = await db
    .insert(githubInstallations)
    .values(installation)
    .returning();

  if (!created) {
    throw new Error("Failed to create GitHub installation");
  }

  return created;
}

export async function getInstallationsByUserId(
  userId: string,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, userId))
    .orderBy(asc(githubInstallations.accountLogin));
}

export async function getInstallationByAccountLogin(
  userId: string,
  accountLogin: string,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.accountLogin, accountLogin),
      ),
    )
    .limit(1);

  return installation;
}

export async function getInstallationByUserAndId(
  userId: string,
  installationId: number,
): Promise<GitHubInstallation | undefined> {
  const [installation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.installationId, installationId),
      ),
    )
    .limit(1);

  return installation;
}

export async function getInstallationsByInstallationId(
  installationId: number,
): Promise<GitHubInstallation[]> {
  return db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId));
}

export async function deleteInstallationByInstallationId(
  installationId: number,
): Promise<number> {
  const deleted = await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  if (deleted.length > 0) {
    await db
      .delete(githubInstallationRepositories)
      .where(eq(githubInstallationRepositories.installationId, installationId));
  }

  return deleted.length;
}

export async function deleteInstallationsByUserId(
  userId: string,
): Promise<number> {
  const deleted = await db
    .delete(githubInstallations)
    .where(eq(githubInstallations.userId, userId))
    .returning({ id: githubInstallations.id });

  if (deleted.length > 0) {
    await db
      .delete(githubInstallationRepositories)
      .where(eq(githubInstallationRepositories.userId, userId));
  }

  return deleted.length;
}

export async function deleteInstallationsNotInList(
  userId: string,
  installationIds: number[],
): Promise<number> {
  if (installationIds.length === 0) {
    return deleteInstallationsByUserId(userId);
  }

  const deleted = await db
    .delete(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, userId),
        notInArray(githubInstallations.installationId, installationIds),
      ),
    )
    .returning({ installationId: githubInstallations.installationId });

  if (deleted.length > 0) {
    await db.delete(githubInstallationRepositories).where(
      and(
        eq(githubInstallationRepositories.userId, userId),
        inArray(
          githubInstallationRepositories.installationId,
          deleted.map((installation) => installation.installationId),
        ),
      ),
    );
  }

  return deleted.length;
}

export async function updateInstallationsByInstallationId(
  installationId: number,
  updates: {
    accountLogin?: string;
    accountType?: "User" | "Organization";
    repositorySelection?: "all" | "selected";
    installationUrl?: string | null;
  },
): Promise<number> {
  if (
    updates.accountLogin === undefined &&
    updates.accountType === undefined &&
    updates.repositorySelection === undefined &&
    updates.installationUrl === undefined
  ) {
    return 0;
  }

  const updated = await db
    .update(githubInstallations)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  return updated.length;
}

export async function markInstallationRepoCacheSynced(
  userId: string,
  installationId: number,
): Promise<number> {
  const updated = await db
    .update(githubInstallations)
    .set({
      repoCacheSyncedAt: new Date(),
      repoCacheStaleAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubInstallations.userId, userId),
        eq(githubInstallations.installationId, installationId),
      ),
    )
    .returning({ id: githubInstallations.id });

  return updated.length;
}

export async function markInstallationRepoCacheStaleByInstallationId(
  installationId: number,
): Promise<number> {
  const now = new Date();
  const updated = await db
    .update(githubInstallations)
    .set({
      repoCacheStaleAt: now,
      updatedAt: now,
    })
    .where(eq(githubInstallations.installationId, installationId))
    .returning({ id: githubInstallations.id });

  return updated.length;
}
