import { connectSandbox, type Sandbox } from "@open-harness/sandbox";
import * as path from "node:path";

export const BASH_TIMEOUT_MS = 120_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getSandboxId(
  experimentalContext: unknown,
  toolName: string,
): string {
  if (!isRecord(experimentalContext)) {
    throw new Error(
      `Missing experimental_context for ${toolName}. Expected { sandboxId: string }`,
    );
  }

  const sandboxId = experimentalContext.sandboxId;
  if (typeof sandboxId !== "string" || sandboxId.trim().length === 0) {
    throw new Error(
      `Missing sandboxId in experimental_context for ${toolName}.`,
    );
  }

  return sandboxId;
}

export function isPathWithinDirectory(
  filePath: string,
  directory: string,
): boolean {
  const resolvedPath = path.resolve(filePath);
  const resolvedDirectory = path.resolve(directory);

  return (
    resolvedPath.startsWith(resolvedDirectory + path.sep) ||
    resolvedPath === resolvedDirectory
  );
}

export function resolveWorkspacePath(
  filePath: string,
  workingDirectory: string,
): string {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workingDirectory, filePath);

  if (!isPathWithinDirectory(absolutePath, workingDirectory)) {
    throw new Error(
      `Path '${filePath}' is outside the working directory '${workingDirectory}'.`,
    );
  }

  return absolutePath;
}

export function toDisplayPath(
  filePath: string,
  workingDirectory: string,
): string {
  const relativePath = path
    .relative(workingDirectory, filePath)
    .replace(/\\/g, "/");

  return relativePath.length > 0 ? relativePath : ".";
}

const sandboxConnections = new Map<string, Promise<Sandbox>>();

export async function getConnectedSandbox(sandboxId: string): Promise<Sandbox> {
  const existingConnection = sandboxConnections.get(sandboxId);
  if (existingConnection) {
    return existingConnection;
  }

  const connection = connectSandbox({ type: "vercel", sandboxId }).catch(
    (error) => {
      sandboxConnections.delete(sandboxId);
      throw error;
    },
  );

  sandboxConnections.set(sandboxId, connection);
  return connection;
}
