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
 */
export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // Not tests. See above.
      "node-api/tests/**",
    ],
  },
});
