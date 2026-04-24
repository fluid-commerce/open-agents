/**
 * Create a new sandbox base snapshot from the currently configured snapshot.
 * Defaults (snapshot id, ports, timeouts) come from the web app sandbox config so
 * this matches production; `refreshBaseSnapshot` skips workspace git bootstrap
 * so the new image stays clone-ready (see `@open-harness/sandbox` snapshot-refresh).
 *
 * Usage:
 *   bun run scripts/vercel-refresh-base-snapshot.ts --command "apt-get update"
 *   bun run scripts/vercel-refresh-base-snapshot.ts --from snap_123 --command "apt-get install -y ripgrep"
 */

import {
  DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS,
  refreshBaseSnapshot,
} from "@open-harness/sandbox/vercel";
import {
  DEFAULT_SANDBOX_BASE_SNAPSHOT_ID,
  DEFAULT_SANDBOX_PORTS,
  DEFAULT_SANDBOX_TIMEOUT_MS,
} from "../apps/web/lib/sandbox/config";

const SANDBOX_BASE_SNAPSHOT_CONFIG_PATH = "apps/web/lib/sandbox/config.ts";

/**
 * Vercel rejects snapshot expirations between 0 (exclusive) and 1 day.
 * See runtime error body:
 *   `expiration` must be 0 (no expiration) or >= 86400000 ms (1 day).
 */
const MIN_SNAPSHOT_EXPIRATION_MS = 86_400_000;

interface CliOptions {
  baseSnapshotId?: string;
  noBase?: boolean;
  sandboxTimeoutMs?: number;
  commandTimeoutMs?: number;
  snapshotExpirationMs?: number;
  commands: string[];
}

interface HelpResult {
  help: true;
}

function printUsage() {
  console.log(`Usage:
  bun run sandbox:snapshot-base -- --command "apt-get update"
  bun run sandbox:snapshot-base -- --from snap_123 --command "apt-get install -y ripgrep"
  bun run sandbox:snapshot-base -- --no-base --snapshot-expiration-ms 0 --command "..."

Options:
  --from <snapshot-id>           Override the starting snapshot id
  --no-base                      Bootstrap a new base snapshot from Vercel's default
                                 image (no starting snapshot). Mutually exclusive
                                 with --from. Useful when no team-owned snapshot
                                 exists yet.
  --command <shell-command>      Command to run inside the sandbox. Repeat as needed.
  --sandbox-timeout-ms <ms>      Sandbox lifetime for the refresh run
  --command-timeout-ms <ms>      Timeout for each setup command (default: ${DEFAULT_BASE_SNAPSHOT_COMMAND_TIMEOUT_MS})
  --snapshot-expiration-ms <ms>  Expiration for the created snapshot, in ms.
                                 Pass 0 for a snapshot that never expires.
                                 Omit to use Vercel's default (30 days).
  --help                         Show this message

Current configured base snapshot:
  ${DEFAULT_SANDBOX_BASE_SNAPSHOT_ID}`);
}

function requireOptionValue(
  argv: string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}.`);
  }

  return value;
}

function parsePositiveNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${option} must be a positive number.`);
  }

  return parsed;
}

function parseNonNegativeNumber(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${option} must be zero or a positive number.`);
  }

  return parsed;
}

function parseArgs(argv: string[]): CliOptions | HelpResult {
  const commands: string[] = [];
  let baseSnapshotId: string | undefined;
  let noBase = false;
  let sandboxTimeoutMs: number | undefined;
  let commandTimeoutMs: number | undefined;
  let snapshotExpirationMs: number | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--from") {
      baseSnapshotId = requireOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg === "--no-base") {
      noBase = true;
      continue;
    }

    if (arg === "--command") {
      commands.push(requireOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg === "--sandbox-timeout-ms") {
      sandboxTimeoutMs = parsePositiveNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    if (arg === "--command-timeout-ms") {
      commandTimeoutMs = parsePositiveNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    if (arg === "--snapshot-expiration-ms") {
      const value = parseNonNegativeNumber(
        requireOptionValue(argv, index, arg),
        arg,
      );
      if (value !== 0 && value < MIN_SNAPSHOT_EXPIRATION_MS) {
        throw new Error(
          `${arg} must be 0 (no expiration) or >= ${MIN_SNAPSHOT_EXPIRATION_MS} ms (1 day).`,
        );
      }
      snapshotExpirationMs = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (noBase && baseSnapshotId !== undefined) {
    throw new Error("--no-base and --from are mutually exclusive.");
  }

  return {
    baseSnapshotId,
    noBase,
    sandboxTimeoutMs,
    commandTimeoutMs,
    snapshotExpirationMs,
    commands,
  };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) {
    printUsage();
    return;
  }

  const baseSnapshotId = parsed.noBase
    ? undefined
    : (parsed.baseSnapshotId ?? DEFAULT_SANDBOX_BASE_SNAPSHOT_ID);

  const result = await refreshBaseSnapshot({
    ...(baseSnapshotId !== undefined && { baseSnapshotId }),
    commands: parsed.commands,
    sandboxTimeoutMs: parsed.sandboxTimeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
    commandTimeoutMs: parsed.commandTimeoutMs,
    ports: DEFAULT_SANDBOX_PORTS,
    ...(parsed.snapshotExpirationMs !== undefined && {
      snapshotExpirationMs: parsed.snapshotExpirationMs,
    }),
    log: (message) => console.log(message),
  });

  console.log("");
  console.log(`New snapshot id: ${result.snapshotId}`);
  console.log(
    result.sourceSnapshotId
      ? `Started from snapshot: ${result.sourceSnapshotId}`
      : "Started from Vercel's default image (no starting snapshot).",
  );
  console.log(
    `Update ${SANDBOX_BASE_SNAPSHOT_CONFIG_PATH} to use: "${result.snapshotId}"`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  const details = (error as { json?: unknown; text?: unknown }) ?? {};
  if (details.json !== undefined) {
    console.error("json:", JSON.stringify(details.json, null, 2));
  }
  if (typeof details.text === "string" && details.text.length > 0) {
    console.error("text:", details.text);
  }
  process.exit(1);
});
