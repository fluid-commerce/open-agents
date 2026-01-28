import { db } from "./client";
import {
  connectedApps,
  type ConnectedApp,
  type NewConnectedApp,
} from "./schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

/**
 * Get the encryption key from environment
 * Reuses CLI_TOKEN_ENCRYPTION_KEY for bot token encryption
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.CLI_TOKEN_ENCRYPTION_KEY;
  if (envKey) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error(
        "CLI_TOKEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)",
      );
    }
    return Buffer.from(envKey, "hex");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("CLI_TOKEN_ENCRYPTION_KEY must be set in production");
  }

  // Fallback for development - derive from a constant (not secure for production)
  return createHash("sha256").update("dev-encryption-key").digest();
}

/**
 * Encrypt a bot token for storage
 */
function encryptBotToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a bot token from storage
 */
export function decryptBotToken(encryptedData: string): string | null {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(":");
    if (!ivHex || !authTagHex || !encrypted) {
      return null;
    }

    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

export async function createConnectedApp(
  data: Omit<NewConnectedApp, "id" | "createdAt" | "updatedAt" | "botToken"> & {
    botToken: string; // Plain text, will be encrypted
  },
): Promise<ConnectedApp> {
  const id = nanoid();
  const now = new Date();
  const encryptedToken = encryptBotToken(data.botToken);

  const [app] = await db
    .insert(connectedApps)
    .values({
      id,
      ...data,
      botToken: encryptedToken,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!app) {
    throw new Error("Failed to create connected app");
  }

  return app;
}

/**
 * Upsert a connected app - updates if exists, creates if not
 */
export async function upsertConnectedApp(
  data: Omit<NewConnectedApp, "id" | "createdAt" | "updatedAt" | "botToken"> & {
    botToken: string; // Plain text, will be encrypted
  },
): Promise<ConnectedApp> {
  const id = nanoid();
  const now = new Date();
  const encryptedToken = encryptBotToken(data.botToken);

  const [app] = await db
    .insert(connectedApps)
    .values({
      id,
      ...data,
      botToken: encryptedToken,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [connectedApps.provider, connectedApps.workspaceId],
      set: {
        workspaceName: data.workspaceName,
        botToken: encryptedToken,
        installedByUserId: data.installedByUserId,
        metadata: data.metadata,
        updatedAt: now,
      },
    })
    .returning();

  if (!app) {
    throw new Error("Failed to upsert connected app");
  }

  return app;
}

export async function getConnectedAppById(
  id: string,
): Promise<ConnectedApp | undefined> {
  const [app] = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.id, id))
    .limit(1);

  return app;
}

export async function getConnectedAppByWorkspace(
  provider: ConnectedApp["provider"],
  workspaceId: string,
): Promise<ConnectedApp | undefined> {
  const [app] = await db
    .select()
    .from(connectedApps)
    .where(
      and(
        eq(connectedApps.provider, provider),
        eq(connectedApps.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  return app;
}

export async function getConnectedAppsByUserId(
  userId: string,
): Promise<ConnectedApp[]> {
  return db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.installedByUserId, userId));
}

export async function getConnectedAppsByProvider(
  provider: ConnectedApp["provider"],
): Promise<ConnectedApp[]> {
  return db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.provider, provider));
}

export async function updateConnectedApp(
  id: string,
  data: Partial<
    Pick<ConnectedApp, "workspaceName" | "metadata" | "installedByUserId">
  > & {
    botToken?: string; // Plain text, will be encrypted if provided
  },
): Promise<ConnectedApp | undefined> {
  const updateData: Partial<ConnectedApp> = {
    ...data,
    updatedAt: new Date(),
  };

  // Encrypt bot token if provided
  if (data.botToken) {
    updateData.botToken = encryptBotToken(data.botToken);
  }

  const [app] = await db
    .update(connectedApps)
    .set(updateData)
    .where(eq(connectedApps.id, id))
    .returning();

  return app;
}

export async function deleteConnectedApp(id: string): Promise<boolean> {
  const result = await db
    .delete(connectedApps)
    .where(eq(connectedApps.id, id))
    .returning({ id: connectedApps.id });

  return result.length > 0;
}

export async function deleteConnectedAppByWorkspace(
  provider: ConnectedApp["provider"],
  workspaceId: string,
): Promise<boolean> {
  const result = await db
    .delete(connectedApps)
    .where(
      and(
        eq(connectedApps.provider, provider),
        eq(connectedApps.workspaceId, workspaceId),
      ),
    )
    .returning({ id: connectedApps.id });

  return result.length > 0;
}
