import { builtinTools, type ToolDefinition } from './builtin-tools.js';

const byName = new Map<string, ToolDefinition>(
  builtinTools.map((t) => [t.name, t]),
);

/** Registry of agent tools (long-run spine). Nodes remain the graph path. */
export function getTool(name: string): ToolDefinition | undefined {
  return byName.get(name);
}

export function listTools(): ToolDefinition[] {
  return [...byName.values()];
}

export function registerTool(tool: ToolDefinition): void {
  byName.set(tool.name, tool);
}

export { builtinTools };
export type { ToolDefinition, ToolContext, ToolResult } from './builtin-tools.js';
