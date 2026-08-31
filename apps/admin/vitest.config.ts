import { defineConfig } from "vitest/config";

/**
 * Node environment on purpose. What is tested here is the pure logic under
 * `src/lib` — graph edits and validation — not components, so nothing needs a
 * DOM or the React plugin, and adding either only creates ways for this to
 * break.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
