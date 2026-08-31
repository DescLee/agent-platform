// Automations management — the parts of Rohit's manual pass that automations.spec.ts (run-banner +
// Back) doesn't cover: the task list, triggering a manual run (POST .../run appends a run and opens
// its live session), pausing via the enable toggle, and deleting. Seeded with one task.
import { expect } from "@playwright/test";
import { test } from "./fixtures";

async function openAutomations(page) {
  await page.goto("/");
  await page.getByTestId("nav-automations").click();
  await expect(page.getByText("由绿巨人按计划重复执行的任务。")).toBeVisible();
}

test("lists a scheduled task with its schedule and run count", async ({ page }) => {
  await openAutomations(page);
  const card = page.locator(".sched-card", { hasText: "Daily AI News" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Every day at ~5:40 PM");
  await expect(card).toContainText("上次状态 running");
});

test("Run now triggers a manual run and opens its live session", async ({ page }) => {
  await openAutomations(page);
  await page.locator(".sched-card", { hasText: "Daily AI News" }).click();
  await page.getByRole("button", { name: /立即运行/ }).click();
  // The manual run opens as a session with the automation-context banner.
  const banner = page.getByTestId("run-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("Daily AI News");
});

test("enable toggle pauses the task", async ({ page }) => {
  await openAutomations(page);
  await page.locator(".sched-card", { hasText: "Daily AI News" }).click();
  await expect(page.getByText(/已启用 · 下次运行/)).toBeVisible();
  // The checkbox is visually hidden behind a styled slider — click the label wrapper.
  await page.locator("label.switch").click();
  await expect(page.getByText("已暂停", { exact: false })).toBeVisible();
});

test("delete removes the task; deleting the last one shows the empty state", async ({ page }) => {
  await openAutomations(page);
  await page.locator(".sched-card", { hasText: "Daily AI News" }).click();
  await page.getByRole("button", { name: /删除/ }).click();
  // Back on the list, the deleted task is gone; the other seeded task remains.
  await expect(page.locator(".sched-card", { hasText: "Daily AI News" })).toHaveCount(0);
  await expect(page.locator(".sched-card", { hasText: "Weekly CRM digest" })).toHaveCount(1);

  await page.locator(".sched-card", { hasText: "Weekly CRM digest" }).click();
  await page.getByRole("button", { name: /删除/ }).click();
  await expect(page.getByText(/暂无自动任务/)).toBeVisible();
});
