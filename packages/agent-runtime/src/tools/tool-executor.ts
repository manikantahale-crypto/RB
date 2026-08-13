import { getTool, type ToolContext, type ToolResult } from './tool-registry.js';

export type AutonomyMap = Partial<
  Record<
    'READ' | 'INTERNAL_WRITE' | 'DATA_SHAPING' | 'CONTROL' | 'EXTERNAL_COMM',
    'AUTO' | 'APPROVE' | 'SUGGEST'
  >
>;

/**
 * Execute a named tool under optional autonomy gate.
 * APPROVE/SUGGEST → does not run side effects; returns gated result.
 */
export async function executeTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
  autonomy?: AutonomyMap,
): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) {
    return { ok: false, error: `UNKNOWN_TOOL: ${name}` };
  }

  const parsed = tool.inputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: `INVALID_TOOL_INPUT: ${parsed.error.message}` };
  }

  const level = autonomy?.[tool.actionClass] ?? 'AUTO';
  if (level === 'APPROVE' || level === 'SUGGEST') {
    return {
      ok: true,
      data: {
        gated: true,
        level,
        tool: name,
        actionClass: tool.actionClass,
        would_run_with: parsed.data,
      },
    };
  }

  try {
    return await tool.execute(parsed.data, ctx);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
