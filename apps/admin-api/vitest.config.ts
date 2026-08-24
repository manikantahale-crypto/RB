import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // No tests here yet. vitest exits 1 on "no test files found", which would
    // fail `npm test --workspaces` for the whole repo.
    passWithNoTests: true,
  },
});
