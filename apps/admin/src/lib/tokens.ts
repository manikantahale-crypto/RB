/**
 * Read a design token at runtime.
 *
 * Most of the app should never need this — CSS and inline styles can write
 * `var(--token)` directly and the browser resolves it. This exists for the
 * one case that cannot: libraries that take colours as plain strings and do
 * their own colour maths on them.
 *
 * Mermaid is the example. Its `themeVariables` are fed to functions that
 * lighten, darken and pick contrasting text, so handing it the literal string
 * "var(--status-success-bg)" produces either a crash or an invisible diagram.
 * It needs the resolved value.
 *
 * The point is that the VALUE still lives in tokens.css. A designer editing
 * one file restyles the mermaid diagram too, which is the whole promise.
 */

/** Resolved token value, e.g. `token("--status-success-bg")` → `"#e6f6ec"`. */
export function token(name: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

/** Several at once, in one style read. */
export function tokens<K extends string>(
  names: Record<K, string>,
): Record<K, string> {
  if (typeof window === "undefined") {
    return Object.fromEntries(
      Object.keys(names).map((k) => [k, ""]),
    ) as Record<K, string>;
  }
  const style = getComputedStyle(document.documentElement);
  const out = {} as Record<K, string>;
  for (const [key, name] of Object.entries(names) as [K, string][]) {
    out[key] = style.getPropertyValue(name).trim();
  }
  return out;
}
