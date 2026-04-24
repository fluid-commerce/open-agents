import { connectSandbox, type SandboxConnectConfig } from "../factory";
import type { ExecResult, SnapshotResult } from "../interface";

export const DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

interface SnapshotSandbox {
  workingDirectory: string;
  exec(command: string, cwd: string, timeoutMs: number): Promise<ExecResult>;
  stop(): Promise<void>;
  snapshot?(opts?: { expiration?: number }): Promise<SnapshotResult>;
}

type SnapshotSandboxConnector = (
  config: SandboxConnectConfig,
) => Promise<SnapshotSandbox>;

export interface RefreshBaseSnapshotOptions {
  /**
   * Starting snapshot to build on top of. Omit to bootstrap a brand-new base
   * snapshot from Vercel's default image (useful when no team-owned snapshot
   * exists yet).
   */
  baseSnapshotId?: string;
  commands?: string[];
  sandboxTimeoutMs: number;
  commandTimeoutMs?: number;
  ports?: number[];
  env?: Record<string, string>;
  /**
   * Expiration for the created snapshot, in milliseconds. Pass 0 for a
   * snapshot that never expires. Omit to use Vercel's default (30 days).
   */
  snapshotExpirationMs?: number;
  log?: (message: string) => void;
}

export interface RefreshBaseSnapshotCommandResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface RefreshBaseSnapshotResult {
  /** Undefined when bootstrapping from Vercel's default image. */
  sourceSnapshotId: string | undefined;
  snapshotId: string;
  commandResults: RefreshBaseSnapshotCommandResult[];
}

interface RefreshBaseSnapshotDependencies {
  connectSandbox?: SnapshotSandboxConnector;
}

function defaultConnectSnapshotSandbox(
  config: SandboxConnectConfig,
): Promise<SnapshotSandbox> {
  return connectSandbox(config);
}

function formatCommandOutput(label: string, output: string): string | null {
  const trimmedOutput = output.trim();
  if (!trimmedOutput) {
    return null;
  }

  return `${label}:\n${trimmedOutput}`;
}

function formatCommandFailure(command: string, result: ExecResult): string {
  const sections = [
    `Command failed while preparing base snapshot: ${command}`,
    result.exitCode === null ? null : `Exit code: ${result.exitCode}`,
    formatCommandOutput("stdout", result.stdout),
    formatCommandOutput("stderr", result.stderr),
    result.truncated ? "Output was truncated." : null,
  ].filter((section): section is string => section !== null);

  return sections.join("\n\n");
}

export async function refreshBaseSnapshot(
  options: RefreshBaseSnapshotOptions,
  dependencies: RefreshBaseSnapshotDependencies = {},
): Promise<RefreshBaseSnapshotResult> {
  const commands =
    options.commands?.filter((command) => command.trim().length > 0) ?? [];
  const commandTimeoutMs =
    options.commandTimeoutMs ?? DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS;
  const log = options.log ?? (() => {});
  const connectSnapshotSandbox =
    dependencies.connectSandbox ?? defaultConnectSnapshotSandbox;

  let sandbox: SnapshotSandbox | null = null;
  let snapshotCreated = false;

  try {
    log(
      options.baseSnapshotId
        ? `Creating sandbox from base snapshot ${options.baseSnapshotId}.`
        : "Creating sandbox from Vercel's default image (no starting snapshot).",
    );
    // Skip git init so the new base image does not ship `.git` in /vercel/sandbox
    // (would break `git clone … .` for agent sandboxes).
    sandbox = await connectSnapshotSandbox({
      state: { type: "vercel" },
      options: {
        ...(options.baseSnapshotId !== undefined && {
          baseSnapshotId: options.baseSnapshotId,
        }),
        timeout: options.sandboxTimeoutMs,
        persistent: false,
        skipGitWorkspaceBootstrap: true,
        ...(options.ports !== undefined && { ports: options.ports }),
        ...(options.env !== undefined && { env: options.env }),
      },
    });

    if (!sandbox.snapshot) {
      throw new Error(
        "Configured sandbox provider does not support snapshots.",
      );
    }

    const commandResults: RefreshBaseSnapshotCommandResult[] = [];

    for (const [index, command] of commands.entries()) {
      log(`Running command ${index + 1}/${commands.length}: ${command}`);

      const result = await sandbox.exec(
        command,
        sandbox.workingDirectory,
        commandTimeoutMs,
      );

      commandResults.push({
        command,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
      });

      if (!result.success) {
        throw new Error(formatCommandFailure(command, result));
      }
    }

    log("Creating snapshot from prepared sandbox.");
    const snapshot = await sandbox.snapshot(
      options.snapshotExpirationMs !== undefined
        ? { expiration: options.snapshotExpirationMs }
        : undefined,
    );
    snapshotCreated = true;
    log(`Created snapshot ${snapshot.snapshotId}.`);

    return {
      sourceSnapshotId: options.baseSnapshotId,
      snapshotId: snapshot.snapshotId,
      commandResults,
    };
  } finally {
    if (sandbox && !snapshotCreated) {
      try {
        await sandbox.stop();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`Failed to stop sandbox after refresh attempt: ${message}`);
      }
    }
  }
}
