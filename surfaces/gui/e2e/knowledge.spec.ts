import { expect, test } from "./fixtures";

test("knowledge library lists conversation files, previews them, and returns to the source session", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-knowledge").click();

  const list = page.getByTestId("knowledge-list");
  await expect(list.getByText("travel-notes.txt")).toBeVisible();
  await expect(list.getByText("security-review.html")).toBeVisible();
  await expect(list.getByText("我上传的")).toBeVisible();
  await expect(list.getByText("助手生成的")).toBeVisible();
  await expect(list.getByText("文件类型")).toBeVisible();
  await expect(list.getByText("HTML", { exact: true })).toBeVisible();
  await expect(page.getByTestId("knowledge-pagination")).toContainText("1 / 2");

  await list.getByText("travel-notes.txt").click();
  await expect(page.getByText("Meet at the south gate.")).toBeVisible();
  await page.getByRole("button", { name: "跳转原会话" }).click();
  await expect(page.getByTestId("knowledge-list")).toHaveCount(0);
});

test("composer @ picker attaches a knowledge-library file", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Draft the launch note").first().click();

  const composer = page.locator("textarea");
  await composer.fill("请总结 @travel");
  const popup = page.getByTestId("knowledge-mention-popup");
  await expect(popup).toBeVisible();
  await popup.getByText("travel-notes.txt").click();

  await expect(page.locator(".attach-chip")).toContainText("travel-notes.txt");
  await expect(composer).toHaveValue("请总结");
});
