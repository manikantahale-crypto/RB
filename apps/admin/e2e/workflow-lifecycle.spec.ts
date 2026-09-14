/**
 * Open a workflow, then drive its lifecycle from the editor.
 *
 * The shape these tests assume is deliberate: the registry is a list with one
 * way in, and everything that acts on a workflow — testing it, putting it
 * live, its history — lives in the editor beside the flow. A list row with
 * four controls is a list you read rather than scan, and it put "fire this for
 * real" a click away from "put this live" on the screen least equipped to warn
 * about either.
 *
 * Needs the local database from scripts/new-project-local.sh and admin-api on
 * 4200. Skipped rather than failed when they are absent: a test that goes red
 * because nobody started a container teaches people to ignore red.
 */

import { test, expect, type Page } from "@playwright/test";

const API = "http://127.0.0.1:4200";

const rowFor = (page: Page, graphKey: string) =>
  page.locator("tbody tr").filter({ hasText: graphKey }).first();

async function newWorkflow(request: any, graphKey: string) {
  const res = await request.post(`${API}/workflows/accept`, {
    headers: { "x-admin-id": "e2e-author" },
    data: {
      graphKey,
      triggerEventType: "syntra.jd.received",
      module: "syntra",
      nodes: [{ id: "process", impl: "syntra.jd.process" }],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeEach(async ({ request }) => {
  const res = await request.get(`${API}/health`).catch(() => null);
  test.skip(!res || !res.ok(), "admin-api is not running on 4200");
});

test("the registry row carries no controls but the menu", async ({
  page,
  request,
}) => {
  const graphKey = `syntra.e2e.list.${Date.now()}`;
  await newWorkflow(request, graphKey);

  await page.goto("/workflows", { waitUntil: "networkidle" });
  const row = rowFor(page, graphKey);
  await expect(row).toBeVisible();

  // The row itself is the way to the runs; everything else is behind the
  // three-dot menu, which is the only control in the row.
  await expect(row.getByRole("button", { name: /More actions/ })).toBeVisible();
  await expect(row.getByRole("button", { name: /^Open$/ })).toHaveCount(0);
  await expect(row.getByRole("link", { name: /^History$/ })).toHaveCount(0);

  // Nothing on the list changes what runs, and nothing fires anything.
  await expect(row.getByRole("button", { name: /Compile|Request|Approve/i })).toHaveCount(0);
  await expect(row.getByRole("link", { name: /^Test/ })).toHaveCount(0);
});

test("clicking the row goes to that workflow's runs", async ({ page, request }) => {
  const graphKey = `syntra.e2e.rowclick.${Date.now()}`;
  await newWorkflow(request, graphKey);

  await page.goto("/workflows", { waitUntil: "networkidle" });
  await rowFor(page, graphKey).click();

  await expect(page).toHaveURL(
    new RegExp(`/workflows/${encodeURIComponent(graphKey).replace(/\./g, "\\.")}/runs$`),
  );
});

test("the menu opens without following the row, and Edit goes to the canvas", async ({
  page,
  request,
}) => {
  const graphKey = `syntra.e2e.menu.${Date.now()}`;
  await newWorkflow(request, graphKey);

  await page.goto("/workflows", { waitUntil: "networkidle" });
  const row = rowFor(page, graphKey);

  // The menu button sits inside a clickable row. Without stopPropagation this
  // navigates to the runs page and the menu is never seen.
  await row.getByRole("button", { name: /More actions/ }).click();
  await expect(page).toHaveURL(/\/workflows$/);
  await expect(page.getByRole("menu")).toBeVisible();

  await page.getByRole("menuitem", { name: /^Edit/ }).click();
  await expect(page).toHaveURL(/\/edit\?version=\d+$/);
  await expect(page.getByTestId("graph-editor")).toBeVisible();
});

test("Open goes to the flow, which carries the lifecycle and history", async ({
  page,
  request,
}) => {
  const graphKey = `syntra.e2e.open.${Date.now()}`;
  await newWorkflow(request, graphKey);

  await page.goto("/workflows", { waitUntil: "networkidle" });
  const row = rowFor(page, graphKey);
  await row.getByRole("button", { name: /More actions/ }).click();
  await page.getByRole("menuitem", { name: /^Edit/ }).click();

  // The working copy is version 0 — the reserved slot. Opening it used to bail
  // on `!version`, which is true for 0, and the page sat on "Loading workflow…"
  // for ever with nothing requested and no error anywhere.
  await expect(page).toHaveURL(/\/edit\?version=0$/);
  await expect(page.getByTestId("graph-editor")).toBeVisible();
  await expect(page.locator(".ge-title")).toContainText(graphKey);

  await expect(page.getByRole("link", { name: /History/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Test/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compile draft/i })).toBeVisible();
});

test("compile → request → approve, from the editor", async ({ page, request }) => {
  const graphKey = `syntra.e2e.cycle.${Date.now()}`;
  await newWorkflow(request, graphKey);

  await page.goto(`/workflows/${encodeURIComponent(graphKey)}/edit?version=0`, {
    waitUntil: "networkidle",
  });

  await page.getByRole("button", { name: /Compile draft/i }).click();
  await expect(page.getByRole("button", { name: /Request v1/i })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole("button", { name: /Request v1/i }).click();
  await expect(page.getByRole("button", { name: /Approve v1/i })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: /^Withdraw$/ })).toBeVisible();

  await page.getByRole("button", { name: /Approve v1/i }).click();

  // Approval creates the binding. Without it the version went live and nothing
  // routed to it: live, and unreachable.
  await expect(page.locator(".wf-said")).toContainText("syntra.jd.received", {
    timeout: 15_000,
  });
});

test("selecting a step shows its contract without crashing", async ({
  page,
  request,
}) => {
  const graphKey = `syntra.e2e.step.${Date.now()}`;
  await newWorkflow(request, graphKey);

  await page.goto(`/workflows/${encodeURIComponent(graphKey)}/edit?version=0`, {
    waitUntil: "networkidle",
  });

  const crashes: string[] = [];
  page.on("pageerror", (e) => crashes.push(e.message));

  await page.getByText("syntra.jd.process").first().click();

  // `execution` and `idempotency` were declared text in authoring.node_registry
  // while every other JSON column was jsonb, so the generator's JSON came back
  // as a STRING. Reading `.retry.limit` off a string threw
  // "Cannot read properties of undefined (reading 'limit')" and the whole
  // editor died behind its error boundary the moment a step was selected.
  await expect(page.getByText(/RETRY/i).first()).toBeVisible({ timeout: 10_000 });
  expect(crashes, crashes.join("; ")).toHaveLength(0);
});
