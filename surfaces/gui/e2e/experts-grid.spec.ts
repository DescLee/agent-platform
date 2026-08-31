import { test, expect } from "./fixtures";

test("expert cards stay at least 260px wide and adapt from one to four columns", async ({ page }, testInfo) => {
  const examples = [
    ["OpenWorker", "处理研究、分析和脚本任务，协助你完成日常工作。", "diamond"],
    ["Code", "在代码仓库中构建、修复和解释代码。", "code"],
    ["会议纪要提取专家", "粘贴会议笔记或转写文本，自动提炼摘要、负责人、截止日期与行动项，归档可检索并联动待办清单跟踪执行。", "table"],
    ["代码审查专家", "检查每一行代码，在缺陷到达生产环境之前将其拦截。", "search"],
    ["自媒体内容写作专家", "专注为小红书、知乎、公众号、抖音生成平台原生的可发布内容，含标题钩子、正文结构与转化引导。", "pencil"],
    ["产品通（产品管理专家）", "产品管理专家，支持功能规格编写、路线图规划、利益相关者沟通、用户研究综合、竞品分析和指标审查。", "sparkle"],
  ];
  await page.route(/\/v1\/personas$/, (route) => route.fulfill({ json: {
    internal: false,
    personas: examples.map(([name, tagline, icon], i) => ({
      id: i === 0 ? "cowork" : `grid-expert-${i}`, name, tagline, icon,
      requires_folder: i === 1, builtin: i < 2, tools: [],
      enabled: i !== 1, surfaced: true, default: i === 0, ships: true, group: "general",
    })),
  } }));
  await page.goto("/");
  await page.getByTestId("nav-coworkers").click();
  const cards = page.locator(".expert-card");
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toHaveCSS("min-height", "140px");
  await expect(page.getByTestId("expert-grid")).toHaveCSS("gap", "16px");
  for (const [width, expectedColumns] of [[720, 1], [960, 2], [1240, 3], [1500, 4], [2600, 4]]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect.poll(async () => {
      const rects = await cards.evaluateAll((nodes) => nodes.map((n) => ({
        width: n.getBoundingClientRect().width, top: n.getBoundingClientRect().top,
      })));
      expect(rects.every((r) => r.width >= 260)).toBe(true);
      return rects.filter((r) => Math.abs(r.top - rects[0].top) < 1).length;
    }).toBe(expectedColumns);
  }
  await page.setViewportSize({ width: 2040, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath("experts-light.png"), fullPage: true, animations: "disabled" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(cards.first()).toHaveCSS("border-top-color", "rgb(42, 45, 51)");
  await page.screenshot({ path: testInfo.outputPath("experts-dark.png"), fullPage: true, animations: "disabled" });
  // Narrow windows scroll this page rather than squeezing cards below the requested width.
  await page.setViewportSize({ width: 600, height: 900 });
  const card = await cards.first().boundingBox();
  expect(card!.width).toBeGreaterThanOrEqual(260);
});
