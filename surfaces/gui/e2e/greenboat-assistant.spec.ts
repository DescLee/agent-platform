import { test, expect } from "./fixtures";

test("greenboat assistant opens an empty placeholder page", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-greenboat-assistant").click();

  await expect(page.getByTestId("nav-greenboat-assistant")).toHaveClass(/bg-chromeHover/);
  await expect(page.getByTestId("greenboat-assistant-placeholder")).toBeVisible();
  await expect(page.getByTestId("composer")).toHaveCount(0);
});
