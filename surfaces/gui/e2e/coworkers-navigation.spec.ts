import { test, expect } from "./fixtures";

test("coworker management lives between search and automations with working detail return", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByTestId("nav-coworkers");
  const search = await page.locator(".sidebar").getByRole("button", { name: "搜索", exact: true }).boundingBox();
  const coworkers = await nav.boundingBox();
  const automations = await page.getByTestId("nav-automations").boundingBox();
  expect(coworkers!.y).toBeGreaterThan(search!.y);
  expect(coworkers!.y).toBeLessThan(automations!.y);
  await nav.click();
  await expect(page.getByText("管理和添加专家，为不同任务选择合适的专业能力。")).toBeVisible();
  await expect(page.locator(".page-subnav")).toHaveCount(0);
  await expect(nav).toHaveClass(/bg-chromeHover/);
  await expect(page.getByTestId("persona-configure-security")).toHaveCount(0);
  await expect(page.locator("main").getByText("Security", { exact: true })).toHaveCount(0);
  await page.getByTestId("unshipped-disclosure").click();
  await page.getByTestId("persona-configure-ops").click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText("管理和添加专家，为不同任务选择合适的专业能力。")).toBeVisible();

  await page.getByTestId("account-row").click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator(".page-subnav")).toBeVisible();
  await expect(page.locator(".page-subnav").getByText("专家", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "新会话", exact: true }).click();
  await page.getByTestId("coworker-chip").click();
  await expect(page.locator(".setup-menu").getByText("Security Coworker", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "管理专家…", exact: true }).click();
  await expect(page.getByText("管理和添加专家，为不同任务选择合适的专业能力。")).toBeVisible();
  await expect(page.locator(".page-subnav")).toHaveCount(0);
});
