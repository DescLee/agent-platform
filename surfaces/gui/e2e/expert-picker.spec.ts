import { test, expect } from "./fixtures";

test("draft expert sits after attach; clearing preserves text and uses coworker", async ({ page }) => {
  const agents: string[] = [];
  await page.routeWebSocket(/\/ws\/session\//, (ws) => {
    agents.push(new URL(ws.url()).searchParams.get("agent") || "");
    ws.send(JSON.stringify({ type: "ready", data: {} }));
  });
  await page.goto("/");
  await page.getByRole("button", { name: "新会话", exact: true }).click();
  const picker = page.locator(".composer").getByTestId("coworker-chip");
  await expect(picker).toHaveText("选择专家");
  await expect(page.getByTestId("setup-row").getByTestId("coworker-chip")).toHaveCount(0);
  const box = page.locator(".composer textarea");
  await box.fill("保留这段草稿");
  await picker.click();
  await page.locator(".setup-menu").getByRole("button", { name: /Ops Coworker/ }).click();
  await expect(picker).toContainText("Ops Coworker");
  await expect.poll(() => agents.at(-1)).toBe("ops");
  await expect(box).toHaveValue("保留这段草稿");
  await box.hover();
  const clear = page.getByTestId("clear-expert");
  await expect(clear).toHaveCSS("opacity", "0");
  await picker.hover();
  await expect(clear).toHaveCSS("opacity", "1");
  const clearBounds = await clear.boundingBox();
  const nameBounds = await picker.boundingBox();
  expect(clearBounds!.x).toBeLessThan(nameBounds!.x);
  await clear.click();
  await expect(picker).toHaveText("选择专家");
  await expect(clear).toHaveCount(0);
  await expect.poll(() => agents.at(-1)).toBe("cowork");
  await expect(box).toHaveValue("保留这段草稿");

  await picker.click();
  await page.locator(".setup-menu").getByRole("button", { name: /Ops Coworker/ }).click();
  await expect.poll(() => agents.at(-1)).toBe("ops");
  await page.getByRole("button", { name: "新会话", exact: true }).click();
  await expect(picker).toHaveText("选择专家");
  await expect.poll(() => agents.at(-1)).toBe("cowork");
  await expect(box).toHaveValue("");
});
