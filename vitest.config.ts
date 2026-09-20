import { defineConfig } from "vitest/config";

/**
 * Root test configuration.
 *
 * THE ONLY THING THIS DOES IS STOP FOUR FILES BEING CALLED TESTS.
 *
 * `node-api/tests/` holds four files ending `.test.js` that are not tests.
 * They are plain Node scripts using `assert`, with no `describe` and no `it`,
 * written to be run by hand. Vitest picks them up on the filename, finds no
 * suite, and reports:
 *
 *     Error: No test suite found in file .../comprehensive-ai-pipeline.test.js
 *
 * Four failures on every run, for months. That is worse than having no tests at
 * all, because a real failure looks exactly the same as the noise and everyone
 * has already learned to scroll past it.
 *
 * They are excluded rather than deleted or renamed: nothing in the repository
 * references them, but they encode real expectations about the AI pipeline and
 * belong to another team. Excluding them is reversible and loses nothing.
 * Turning them into real suites is worth doing, and is not this change.
 *
 * `node-api/structure.test.js` IS a real suite and still runs — it sits outside
 * `tests/` deliberately.
 *
 * THE SAME PROBLEM, FROM THE OTHER DIRECTION: `apps/admin/e2e/` holds
 * Playwright specs. They are real tests, but they are Playwright's — their
 * `test.beforeEach` takes `{ request }`, a fixture only Playwright supplies —
 * so vitest loads them, fails to construct the suite, and reports two failures
 * on every run. `npx vitest run` has therefore ended in red regardless of the
 * state of the code, which is the same lesson learned twice: a suite that is
 * always red teaches people not to read it.
 *
 * They run under `npm run test:e2e -w @tekisho/admin`, which is Playwright.
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Not tests. See above.
      "node-api/tests/**",
      // Tests, but Playwright's. See above.
      "**/e2e/**",
      // Other checkouts of this repository, kept beside it for reference and
      // never committed. Their tests need their own node_modules.
      "old_db_repo/**",
      "orch_old-db/**",
      "new_db_feature_branch/**",
    ],
  },
});
