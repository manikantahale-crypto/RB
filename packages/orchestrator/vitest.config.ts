import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Both layouts, deliberately. This package used to match only `tests/**`,
    // which meant a test written beside the code — the layout node-contract
    // and routing-contract use — was silently skipped while CI stayed green.
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // vitest exits 1 on "no test files found", which fails
    // `npm test --workspaces` for every package that has none yet.
    passWithNoTests: true,
  },
});
