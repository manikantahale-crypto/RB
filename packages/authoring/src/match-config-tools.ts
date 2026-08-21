/** Tools that accept matchThreshold / hardFilters / rerank in node.config (any agent). */
export const MATCH_CONFIG_IMPLS = [
  "syntra.match.process",
  "syntra.continuous.match",
] as const;

export function isMatchConfigImpl(impl: string): boolean {
  return (MATCH_CONFIG_IMPLS as readonly string[]).includes(impl);
}
