import type { ToolSet } from "ai";
import { bashTool } from "./bash";
import { editTool } from "./edit";
import { readTool } from "./read";
import { writeTool } from "./write";

export { bashTool } from "./bash";
export { editTool } from "./edit";
export { readTool } from "./read";
export { writeTool } from "./write";

export const durableAgentTools = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  bash: bashTool,
} satisfies ToolSet;

export type DurableAgentTools = typeof durableAgentTools;
