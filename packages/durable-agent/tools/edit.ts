import { tool } from "ai";
import { z } from "zod";
import {
  getConnectedSandbox,
  getSandboxId,
  resolveWorkspacePath,
  toDisplayPath,
} from "./utils";

export const editTool = tool({
  description: `Make exact string replacements in an existing file.

IMPORTANT:
- oldString must match exactly, including whitespace
- Use replaceAll=true for multiple replacements`,
  inputSchema: z.object({
    filePath: z.string().describe("Workspace-relative file path"),
    oldString: z.string().describe("Exact text to replace"),
    newString: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences"),
    startLine: z.number().optional().describe("Line where oldString starts"),
  }),
  execute: async (
    { filePath, oldString, newString, replaceAll = false },
    { experimental_context },
  ) => {
    const sandboxId = getSandboxId(experimental_context, "edit");
    const sandbox = await getConnectedSandbox(sandboxId);
    const workingDirectory = sandbox.workingDirectory;

    try {
      if (oldString === newString) {
        return {
          success: false,
          error: "oldString and newString must be different.",
        };
      }

      const absolutePath = resolveWorkspacePath(filePath, workingDirectory);
      const content = await sandbox.readFile(absolutePath, "utf-8");

      if (!content.includes(oldString)) {
        return {
          success: false,
          error: "oldString not found in file.",
        };
      }

      const occurrences = content.split(oldString).length - 1;
      if (occurrences > 1 && !replaceAll) {
        return {
          success: false,
          error: `oldString found ${occurrences} times. Set replaceAll=true or provide a more specific oldString.`,
        };
      }

      const matchIndex = content.indexOf(oldString);
      const detectedStartLine = content.slice(0, matchIndex).split("\n").length;

      const newContent = replaceAll
        ? content.replaceAll(oldString, newString)
        : content.replace(oldString, newString);

      await sandbox.writeFile(absolutePath, newContent, "utf-8");

      return {
        success: true,
        path: toDisplayPath(absolutePath, workingDirectory),
        replacements: replaceAll ? occurrences : 1,
        startLine: detectedStartLine,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
