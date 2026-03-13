import { tool } from "ai";
import { z } from "zod";
import {
  getConnectedSandbox,
  getSandboxId,
  resolveWorkspacePath,
  toDisplayPath,
} from "./utils";

export const readTool = tool({
  description: `Read file contents from the sandbox filesystem.

USAGE:
- Use workspace-relative paths (e.g., "src/index.ts")
- By default reads up to 2000 lines from line 1
- Use offset and limit for partial reads

IMPORTANT:
- Always read files before editing them
- This tool reads files only (not directories)`,
  inputSchema: z.object({
    filePath: z.string().describe("Workspace-relative file path"),
    offset: z.number().optional().describe("Start line number (1-indexed)"),
    limit: z.number().optional().describe("Maximum lines to read"),
  }),
  execute: async (
    { filePath, offset = 1, limit = 2000 },
    { experimental_context },
  ) => {
    const sandboxId = getSandboxId(experimental_context, "read");
    const sandbox = await getConnectedSandbox(sandboxId);
    const workingDirectory = sandbox.workingDirectory;

    try {
      const absolutePath = resolveWorkspacePath(filePath, workingDirectory);
      const stats = await sandbox.stat(absolutePath);

      if (stats.isDirectory()) {
        return {
          success: false,
          error: "Cannot read a directory.",
        };
      }

      const content = await sandbox.readFile(absolutePath, "utf-8");
      const lines = content.split("\n");
      const startLine = Math.max(1, offset) - 1;
      const endLine = Math.min(lines.length, startLine + limit);
      const selectedLines = lines.slice(startLine, endLine);

      return {
        success: true,
        path: toDisplayPath(absolutePath, workingDirectory),
        totalLines: lines.length,
        startLine: startLine + 1,
        endLine,
        content: selectedLines
          .map((line, index) => `${startLine + index + 1}: ${line}`)
          .join("\n"),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
