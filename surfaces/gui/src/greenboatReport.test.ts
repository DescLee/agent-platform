import { describe, expect, it } from "vitest";
import { greenboatReport, greenboatSummaryPrompt } from "./greenboatReport";

describe("Greenboat summary draft", () => {
  it("counts read, unread and unknown separately and includes direct mentions", () => {
    const report = greenboatReport("2026-09-03", [{ id: "c", name: "工作群", warnings: [], messages: [
      { id: "1", time: "10:00", stamp: 1, sender: "同事", text: "请回复", readState: "unread", mentionMe: true },
      { id: "2", time: "11:00", stamp: 2, sender: "我", text: "完成", readState: "read", outgoing: true },
      { id: "3", time: "12:00", stamp: 3, sender: "同事", text: "通知", mentionAll: true },
    ] }], []);
    expect(report).toContain("已读 1 条 · 未读 1 条 · 状态未知 1 条");
    expect(report).toContain("## @我的事项索引");
    expect(report).toContain("直接@我"); expect(report).toContain("@所有人");
    expect(report).toContain("我发送的");
  });
  it("prepares separate read/unread and @me sections without automatic actions", () => {
    const prompt = greenboatSummaryPrompt("2026-09-03", "report.md");
    for (const text of ["report.md", "今日已读消息", "今日未读消息", "【重点：@我的事项】", "状态未知", "不自动发送消息"]) expect(prompt).toContain(text);
  });
});
