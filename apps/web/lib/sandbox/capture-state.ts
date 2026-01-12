import path from "node:path";
import type { Sandbox } from "@open-harness/sandbox";

const MAX_UNTRACKED_FILE_BYTES = 1_048_576;
const COMMAND_TIMEOUT_MS = 30_000;
const DIFF_TIMEOUT_MS = 60_000;

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function readFileAsBase64(
  sandbox: Sandbox,
  absolutePath: string,
  cwd: string,
): Promise<string | null> {
  const result = await sandbox.exec(
    `base64 ${shellEscape(absolutePath)}`,
    cwd,
    COMMAND_TIMEOUT_MS,
  );

  if (!result.success) {
    return null;
  }

  return result.stdout.replace(/\s+/g, "");
}

export async function captureSandboxState(sandbox: Sandbox): Promise<{
  diffContent: string;
  untrackedFiles: Array<{ path: string; content: string }>;
  baseCommit: string;
}> {
  const cwd = sandbox.workingDirectory;

  const baseCommitResult = await sandbox.exec(
    "git rev-parse HEAD",
    cwd,
    COMMAND_TIMEOUT_MS,
  );
  const baseCommit = baseCommitResult.success
    ? baseCommitResult.stdout.trim()
    : "";

  const diffResult = await sandbox.exec("git diff HEAD", cwd, DIFF_TIMEOUT_MS);
  const diffContent = diffResult.success ? diffResult.stdout : "";

  const untrackedResult = await sandbox.exec(
    "git ls-files --others --exclude-standard",
    cwd,
    COMMAND_TIMEOUT_MS,
  );

  if (!untrackedResult.success) {
    return { diffContent, untrackedFiles: [], baseCommit };
  }

  const untrackedPaths = untrackedResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const untrackedFiles: Array<{ path: string; content: string }> = [];

  for (const relativePath of untrackedPaths) {
    const absolutePath = path.posix.join(cwd, relativePath);

    let stats: Awaited<ReturnType<Sandbox["stat"]>>;
    try {
      stats = await sandbox.stat(absolutePath);
    } catch {
      continue;
    }

    if (!stats.isFile() || stats.size > MAX_UNTRACKED_FILE_BYTES) {
      continue;
    }

    const content = await readFileAsBase64(sandbox, absolutePath, cwd);
    if (content === null) {
      continue;
    }

    untrackedFiles.push({ path: relativePath, content });
  }

  return { diffContent, untrackedFiles, baseCommit };
}
