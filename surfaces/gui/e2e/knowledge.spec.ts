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
