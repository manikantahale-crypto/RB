/**
 * The registry renders, and says so out loud when it does not.
 *
 * A React page that throws during render leaves a white screen and nothing
 * else — no message, no stack, nothing in the server log, because the failure
 * is in the browser. This test exists to turn that into a sentence: it fails
 * with the actual console error rather than "expected something, got nothing".
 */

import { test, expect } from "@playwright/test";

test("the workflows registry renders without a console error", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("pageerror", (e) => problems.push(`${e.name}: ${e.message}`));

  await page.goto("/workflows", { waitUntil: "networkidle" });

  // Reported before any assertion about the DOM, because the console error is
  // the useful half and an assertion failure would hide it.
  if (problems.length > 0) {
    throw new Error(
      `The page reported ${problems.length} error(s):\n  ` +
        problems.join("\n  "),
    );
  }

  await expect(page.getByTestId("workflows-registry")).toBeVisible();
});
