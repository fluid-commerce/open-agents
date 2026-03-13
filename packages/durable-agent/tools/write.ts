import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import {
  getConnectedSandbox,
  getSandboxId,
  resolveWorkspacePath,
  toDisplayPath,
} from "./utils";

export const writeTool = tool({
  description: `Create or overwrite files in the sandbox.

WHEN TO USE:
- Creating new files
- Rewriting full file contents

IMPORTANT:
- Prefer edit for small changes to existing files`,
  inputSchema: z.object({
    filePath: z.string().describe("Workspace-relative file path"),
    content: z.string().describe("File content"),
  }),
  execute: async ({ filePath, content }, { experimental_context }) => {
    const sandboxId = getSandboxId(experimental_context, "write");
    const sandbox = await getConnectedSandbox(sandboxId);
    const workingDirectory = sandbox.workingDirectory;

    try {
      const absolutePath = resolveWorkspacePath(filePath, workingDirectory);
      const directoryPath = path.dirname(absolutePath);

      await sandbox.mkdir(directoryPath, { recursive: true });
      await sandbox.writeFile(absolutePath, content, "utf-8");

      const stats = await sandbox.stat(absolutePath);

      return {
        success: true,
        path: toDisplayPath(absolutePath, workingDirectory),
        bytesWritten: stats.size,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
