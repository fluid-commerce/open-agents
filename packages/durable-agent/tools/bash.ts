import { tool } from "ai";
import { z } from "zod";
import {
  BASH_TIMEOUT_MS,
  getConnectedSandbox,
  getSandboxId,
  resolveWorkspacePath,
} from "./utils";

export const bashTool = tool({
  description: `Execute a non-interactive bash command in the sandbox.

USAGE:
- Runs with a 120 second timeout by default
- Use detached=true for long-running background commands
- Use cwd for workspace-relative subdirectories`,
  inputSchema: z.object({
    command: z.string().describe("Bash command to execute"),
    cwd: z.string().optional().describe("Workspace-relative working directory"),
    detached: z.boolean().optional().describe("Run command in the background"),
  }),
  execute: async ({ command, cwd, detached }, { experimental_context }) => {
    const sandboxId = getSandboxId(experimental_context, "bash");
    const sandbox = await getConnectedSandbox(sandboxId);
    const workingDirectory = sandbox.workingDirectory;

    try {
      const workingDir = cwd
        ? resolveWorkspacePath(cwd, workingDirectory)
        : workingDirectory;

      if (detached) {
        if (!sandbox.execDetached) {
          return {
            success: false,
            exitCode: null,
            stdout: "",
            stderr: "Detached execution is not supported by this sandbox.",
          };
        }

        const { commandId } = await sandbox.execDetached(command, workingDir);
        return {
          success: true,
          exitCode: null,
          stdout: `Process started in background (command ID: ${commandId}).`,
          stderr: "",
        };
      }

      const result = await sandbox.exec(command, workingDir, BASH_TIMEOUT_MS);
      return {
        success: result.success,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        ...(result.truncated && { truncated: true }),
      };
    } catch (error) {
      return {
        success: false,
        exitCode: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
