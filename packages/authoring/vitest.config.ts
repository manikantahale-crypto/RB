import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Both layouts — see the note in packages/orchestrator/vitest.config.ts.
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
