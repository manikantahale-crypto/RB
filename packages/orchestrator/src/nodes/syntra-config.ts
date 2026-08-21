/**
 * Shared node.config → Syntra HTTP body options.
 * Any matching tool may use these — not tied to a single agent or impl.
 */
export function optionsFromNodeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof config.matchThreshold === 'number') {
    out.matchThreshold = config.matchThreshold;
  }
  if (typeof config.rerank === 'boolean') {
    out.rerank = config.rerank;
  }
  if (
    Array.isArray(config.hardFilters) &&
    config.hardFilters.length > 0
  ) {
    out.hardFilters = config.hardFilters;
  }
  if (typeof config.prompt === 'string' && config.prompt.trim()) {
    out.prompt = config.prompt.trim();
  }
  return out;
}

/** Tools that accept matchThreshold / hardFilters / rerank in node.config. */
export const MATCH_CONFIG_IMPLS = [
  'syntra.match.process',
  'syntra.continuous.match',
] as const;

export function isMatchConfigImpl(impl: string): boolean {
  return (MATCH_CONFIG_IMPLS as readonly string[]).includes(impl);
}
