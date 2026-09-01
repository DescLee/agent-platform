import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SkillsTab } from "./SkillsTab";

// SKILLS-SPEC §5/§6 GUI — Settings ▸ Skills: list + badges + rich-skill file counts, form
// validation, the doors (write form / upload-with-preview / doorway-to-conversation).

type Call = { url: string; method: string; body: any };

function stubFetch(routes: { match: string; method?: string; json: any }[]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method || "GET").toUpperCase();
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const r of routes) {
      if (url.includes(r.match) && (!r.method || r.method === method)) {
        return { ok: true, json: async () => r.json } as Response;
      }
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

const ROW = {
  name: "weekly-report",
  description: "Monday status report",
  instructions: "1. Collect updates\n2. Write it up",
  scope: "global",
  source: "local",
  enabled: true,
  path: "/skills/weekly-report",
};

const UPLOADED_ROW = {
  ...ROW,
  name: "greet",
  description: "says hello",
  source: "uploaded",
  enabled: false,
};

const LIST = { skills: [ROW, UPLOADED_ROW] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The single add-action: open the "Add skill" menu, pick a door (SKILLS-SPEC §5).
const openWriteForm = async () => {
  fireEvent.click(screen.getByRole("button", { name: "我的" }));
  fireEvent.click(await screen.findByRole("button", { name: /添加技能/ }));
  fireEvent.click(screen.getByText("自行编写"));
};

describe("SkillsTab", () => {
  it("uses one filter row with 我的 immediately after 全部", async () => {
    stubFetch([
      { match: "/v1/skillhub/categories", json: { ok: true, categories: [] } },
      { match: "/v1/skillhub/skills", json: { ok: true, skills: [], total: 0 } },
      { match: "/v1/skills", method: "GET", json: LIST },
    ]);
    render(<SkillsTab />);
    const filters = screen.getByTestId("skillhub-categories");
    expect(filters.textContent).toBe("全部我的");
    expect(screen.queryByText("我的技能")).toBeNull();
    expect(screen.queryByText("可供协作助手在所有会话中遵循的复用指令；在此关闭后将全局停用。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    expect(await screen.findByText("weekly-report")).toBeTruthy();
  });

  it("loads and appends the next SkillHub page when the content region reaches the bottom", async () => {
    const skill = (name: string, slug: string) => ({
      name,
      slug,
      publisher: "tester",
      description: `${name} description`,
      category: "",
      icon_url: "",
      url: `https://skillhub.cn/skills/${slug}`,
      verified: false,
      stars: 0,
      downloads: 0,
    });
    const fetchMock = vi.fn(async (url: string) => {
      let json: unknown;
      if (url.includes("/v1/skillhub/categories")) {
        json = { ok: true, categories: [] };
      } else if (url.includes("/v1/skillhub/skills")) {
        json = url.includes("page=2")
          ? { ok: true, skills: [skill("第二页技能", "second")], total: 25 }
          : { ok: true, skills: [skill("第一页技能", "first")], total: 25 };
      } else {
        json = { skills: [] };
      }
      return { ok: true, json: async () => json } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SkillsTab />);

    expect(await screen.findByText("第一页技能")).toBeTruthy();
    expect(screen.queryByText(/收藏|下载/)).toBeNull();
    const region = screen.getByTestId("skills-scroll-region");
    Object.defineProperties(region, {
      scrollHeight: { configurable: true, value: 1_000 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, value: 450 },
    });
    fireEvent.scroll(region);

    expect(await screen.findByText("第二页技能")).toBeTruthy();
    expect(screen.getByText("第一页技能")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("page=2"))).toBe(true);
    expect(screen.queryByText(/全部技能|第 1 \/|下一页/)).toBeNull();
  });

  it("opens a skill detail page from a catalog card and can return to the list", async () => {
    const calls = stubFetch([
      { match: "/v1/skillhub/categories", json: { ok: true, categories: [] } },
      { match: "/v1/skillhub/skills/docs/install", method: "POST", json: { ok: true, name: "docs" } },
      { match: "/v1/skillhub/skills/docs/overview?namespace=tester", json: { ok: true, overview: "完整的技能概述" } },
      { match: "/v1/skillhub/skills/docs/evaluation?namespace=tester", json: { ok: true, evaluation: { userSummary: "安全性与可用性评测通过", dimensions: {
        trust: { userReason: "安全可靠", items: { scan: { score: 4.7 } } },
      } } } },
      { match: "/v1/skillhub/skills/docs?namespace=tester", json: { ok: true, skill: {
        name: "文档助手", slug: "docs", namespace: "tester", publisher: "tester", description: "处理文档",
        category: "", icon_url: "", url: "https://skillhub.cn/skills/docs", verified: false,
        stars: 12, downloads: 34, tags: ["办公", "文档"], rating: 0, evaluation_report: "",
      } } },
      { match: "/v1/skillhub/skills", json: { ok: true, total: 1, skills: [{
        name: "文档助手", slug: "docs", namespace: "tester", publisher: "tester", description: "处理文档",
        category: "", icon_url: "", url: "https://skillhub.cn/skills/docs", verified: false,
        stars: 12, downloads: 34, tags: ["办公", "文档"], overview: "完整的技能概述",
        rating: 4.7, evaluation_report: "安全性与可用性评测通过",
      }] } },
      { match: "/v1/skills", method: "GET", json: { skills: [] } },
    ]);
    const onDetailChange = vi.fn();
    const onUseSkill = vi.fn();
    render(<SkillsTab onDetailChange={onDetailChange} onUseSkill={onUseSkill} />);

    fireEvent.click(await screen.findByRole("button", { name: /文档助手/ }));
    expect(onDetailChange).toHaveBeenCalledWith(true);
    const detailPage = screen.getByTestId("skill-detail-page");
    const backButton = screen.getByRole("button", { name: "返回技能列表" });
    const scrollRegion = screen.getByTestId("skill-detail-scroll-region");
    expect(backButton.parentElement).toBe(detailPage);
    expect(scrollRegion.contains(backButton)).toBe(false);
    expect(await screen.findByText("完整的技能概述")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "安装" }));
    expect(await screen.findByRole("button", { name: "使用" })).toBeTruthy();
    expect(calls.find((call) => call.url.includes("/docs/install"))?.body).toEqual({ namespace: "tester" });
    fireEvent.click(screen.getByRole("button", { name: "使用" }));
    expect(onUseSkill).toHaveBeenCalledWith("docs");
    expect(screen.queryByTestId("trace-score-summary")).toBeNull();
    expect(calls.some((call) => call.url.includes("/evaluation"))).toBe(false);

    fireEvent.click(screen.getByRole("tab", { name: "评分" }));
    expect(await screen.findByText("4.7")).toBeTruthy();
    expect(screen.getByText("安全性与可用性评测通过")).toBeTruthy();
    expect(screen.getByText("办公")).toBeTruthy();
    expect(screen.queryByText(/收藏|下载/)).toBeNull();
    expect(screen.getByRole("img", { name: "TRACE 五维评分雷达图" })).toBeTruthy();
    expect(screen.getByTestId("trace-dimension-details")).toBeTruthy();
    expect(screen.getByText("T · 可信任度")).toBeTruthy();
    expect(screen.getByText("4.7 /5")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "概述" }));
    fireEvent.click(screen.getByRole("tab", { name: "评分" }));
    expect(calls.filter((call) => call.url.includes("/evaluation")).length).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "返回技能列表" }));
    expect(onDetailChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("skillhub-catalog")).toBeTruthy();
  });

  it("keeps the overview response when base detail finishes later", async () => {
    let resolveDetail!: (value: Response) => void;
    const delayedDetail = new Promise<Response>((resolve) => { resolveDetail = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/skillhub/categories")) return Promise.resolve({ json: async () => ({ ok: true, categories: [] }) } as Response);
      if (url.includes("/docs/overview?namespace=tester")) return Promise.resolve({ json: async () => ({ ok: true, overview: "接口返回的完整概述正文" }) } as Response);
      if (url.includes("/docs?namespace=tester")) return delayedDetail;
      if (url.includes("/v1/skillhub/skills")) return Promise.resolve({ json: async () => ({ ok: true, total: 1, skills: [{
        name: "文档助手", slug: "docs", namespace: "tester", publisher: "tester", description: "卡片短描述",
        category: "", icon_url: "", url: "", verified: false, stars: 0, downloads: 0,
        tags: [], overview: "卡片短描述", rating: 0, evaluation_report: "",
      }] }) } as Response);
      return Promise.resolve({ json: async () => ({ skills: [] }) } as Response);
    }));
    render(<SkillsTab />);

    fireEvent.click(await screen.findByRole("button", { name: /文档助手/ }));
    expect(await screen.findByText("接口返回的完整概述正文")).toBeTruthy();
    resolveDetail({ json: async () => ({ ok: true, skill: { description: "详情接口描述" } }) } as Response);
    expect(await screen.findByText("详情接口描述")).toBeTruthy();
    expect(screen.getByText("接口返回的完整概述正文")).toBeTruthy();
    expect(screen.queryByText("卡片短描述", { selector: ".md *" })).toBeNull();
  });

  it("renders rows with provenance badges and dims disabled skills", async () => {
    stubFetch([{ match: "/v1/skills", method: "GET", json: LIST }]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    expect(await screen.findByText("weekly-report")).toBeTruthy();
    expect(screen.getByText("Monday status report")).toBeTruthy();
    expect(screen.queryByText("global")).toBeNull(); // no scope badges — global-only (§4.7)
    expect(screen.getByText("uploaded")).toBeTruthy(); // provenance badge stays
    const toggles = screen.getAllByRole("switch");
    expect((toggles[0] as HTMLInputElement).checked).toBe(true);
    expect((toggles[1] as HTMLInputElement).checked).toBe(false);
  });

  it("blocks Save until name and instructions are filled", async () => {
    stubFetch([{ match: "/v1/skills", method: "GET", json: { skills: [] } }]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await openWriteForm();
    const save = screen.getByText("保存技能") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "greet" } });
    expect(save.disabled).toBe(true); // instructions still empty
    fireEvent.change(screen.getByLabelText("指令"), {
      target: { value: "Say hello." },
    });
    expect(save.disabled).toBe(false);
  });

  it("creates a skill (global, no scope field) and refreshes the list", async () => {
    const calls = stubFetch([
      { match: "/v1/skills", method: "GET", json: { skills: [] } },
      { match: "/v1/skills", method: "POST", json: { ok: true } },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await openWriteForm();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "greet" } });
    fireEvent.change(screen.getByLabelText("指令"), {
      target: { value: "Say hello." },
    });
    fireEvent.click(screen.getByText("保存技能"));
    await waitFor(() => {
      const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/v1/skills"));
      expect(post?.body).toMatchObject({ name: "greet", instructions: "Say hello." });
      expect(post?.body.workspace).toBeUndefined(); // global-only: no scope/workspace sent
    });
    // list re-fetched after save
    expect(calls.filter((c) => c.method === "GET" && c.url.includes("/v1/skills")).length).toBeGreaterThan(1);
  });

  it("edit prefills the form (name locked, body loaded) and PATCHes on save", async () => {
    const calls = stubFetch([
      { match: "/v1/skills", method: "GET", json: LIST },
      { match: "/v1/skills/weekly-report", method: "PATCH", json: { ok: true } },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await screen.findByText("weekly-report");
    fireEvent.click(screen.getAllByTitle("编辑")[0]);
    const name = screen.getByLabelText("名称") as HTMLInputElement;
    expect(name.value).toBe("weekly-report");
    expect(name.disabled).toBe(true);
    const body = screen.getByLabelText("指令") as HTMLTextAreaElement;
    expect(body.value).toContain("Collect updates");
    fireEvent.change(body, { target: { value: "New steps" } });
    fireEvent.click(screen.getByText("保存技能"));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch?.url).toContain("/v1/skills/weekly-report");
      expect(patch?.body.instructions).toBe("New steps");
    });
  });

  it("delete is two-step: arm, then DELETE on confirm", async () => {
    const calls = stubFetch([
      { match: "/v1/skills", method: "GET", json: LIST },
      { match: "/v1/skills/weekly-report", method: "DELETE", json: { ok: true } },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await screen.findByText("weekly-report");
    // arm via the trash button (renders "Confirm delete" once armed)
    fireEvent.click(screen.getByLabelText("删除 weekly-report"));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    const confirm = await screen.findByText("确认删除");
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.url.includes("weekly-report"))).toBe(true);
    });
  });

  it("the enabled switch PATCHes {enabled} and teaches the off rule + physics footnote", async () => {
    const calls = stubFetch([
      { match: "/v1/skills", method: "GET", json: LIST },
      { match: "/v1/skills/weekly-report", method: "PATCH", json: { ok: true } },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await screen.findByText("weekly-report");
    fireEvent.click(screen.getByLabelText("weekly-report enabled"));
    await waitFor(() => {
      const patch = calls.find((c) => c.method === "PATCH");
      expect(patch?.body).toMatchObject({ enabled: false });
    });
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("weekly-report"); // name-first — WHICH skill
    expect(status.textContent).toContain("已在所有位置关闭");
    expect(status.textContent).toContain("完全干净的上下文"); // the guaranteed remedy, in place
  });

  it("upload shows the parsed preview and installs nothing until confirmed", async () => {
    const calls = stubFetch([
      { match: "/v1/skills/upload/confirm", method: "POST", json: { ok: true } },
      {
        match: "/v1/skills/upload",
        method: "POST",
        json: {
          ok: true,
          token: "t1",
          name: "greet",
          description: "says hello",
          instructions: "Say hello warmly.",
          files: ["notes.txt"],
        },
      },
      { match: "/v1/skills", method: "GET", json: { skills: [] } },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    const input = (await screen.findByLabelText("上传技能包")) as HTMLInputElement;
    const file = new File([new Uint8Array([80, 75, 3, 4])], "greet.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("安装前审核");
    expect(screen.getByText("Say hello warmly.")).toBeTruthy();
    expect(screen.getByText(/notes\.txt/)).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/upload/confirm"))).toBe(false); // preview ≠ install
    fireEvent.click(screen.getByText("安装技能"));
    await waitFor(() => {
      const confirm = calls.find((c) => c.url.includes("/upload/confirm"));
      expect(confirm?.body).toMatchObject({ token: "t1" });
    });
  });

  it("Add skill menu: three doors; Create with OpenWorker hands off to a conversation", async () => {
    const calls = stubFetch([{ match: "/v1/skills", method: "GET", json: { skills: [] } }]);
    const onCreateSkill = vi.fn();
    render(<SkillsTab onCreateSkill={onCreateSkill} />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    fireEvent.click(await screen.findByRole("button", { name: /添加技能/ }));
    // The three doors (§5), each with its teaching subtitle.
    expect(screen.getByText("自行编写")).toBeTruthy();
    expect(screen.getByText("导入文件")).toBeTruthy();
    expect(screen.getByText(/安装前可先审核/)).toBeTruthy();
    expect(screen.getByText(/加入技能库前征求你的同意/)).toBeTruthy();
    fireEvent.click(screen.getByText("使用绿巨人创建"));
    // Straight to the conversation — the composer is where you describe it (§5.2).
    expect(onCreateSkill).toHaveBeenCalledWith("");
    // Settings never drafts: no POST of any kind happened.
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("offers no scope UI at all — skills are global (§4.7)", async () => {
    stubFetch([{ match: "/v1/skills", method: "GET", json: { skills: [] } }]);
    render(<SkillsTab />);
    await openWriteForm();
    expect(screen.queryByText("适用范围")).toBeNull();
    expect(screen.queryByLabelText("Everywhere")).toBeNull();
    expect(screen.queryByLabelText("Only one project")).toBeNull();
    expect(screen.queryByText(/Move to/)).toBeNull();
  });

  it("shows the new-session confirmation line after creating a skill", async () => {
    stubFetch([
      { match: "/v1/skills", method: "GET", json: { skills: [] } },
      { match: "/v1/skills", method: "POST", json: { ok: true } },
    ]);
    render(<SkillsTab />);
    await openWriteForm();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "greet" } });
    fireEvent.change(screen.getByLabelText("指令"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("保存技能"));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("greet"); // name-first — WHICH skill
    expect(status.textContent).toContain("可在所有会话中使用此技能");
  });

  it("the list is the page: no standing add-surfaces, no drafting remnants", async () => {
    stubFetch([{ match: "/v1/skills", method: "GET", json: { skills: [] } }]);
    render(<SkillsTab onCreateSkill={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await screen.findByRole("button", { name: /添加技能/ });
    // No permanently-open description box or draft-era UI (§5.2/§9) — adding is menu-only.
    expect(screen.queryByLabelText("Describe the skill")).toBeNull();
    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.queryByText("Ask OpenWorker to revise")).toBeNull();
    expect(screen.queryByText(/Not a chat/)).toBeNull();
    // The menu closes after picking a door.
    await openWriteForm();
    expect(screen.queryByText("自行编写")).toBeNull();
    expect(screen.getByText("保存技能")).toBeTruthy();
  });

  it("surfaces server-side validation errors", async () => {
    stubFetch([
      { match: "/v1/skills", method: "GET", json: { skills: [] } },
      { match: "/v1/skills", method: "POST", json: { ok: false, error: "A skill named 'x' already exists in that scope." } },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    await openWriteForm();
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("指令"), { target: { value: "y" } });
    fireEvent.click(screen.getByText("保存技能"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/already exists/)).toBeTruthy();
  });
});

describe("SkillsTab — rich-skill disclosure (§6)", () => {
  it("shows a file count only when a skill bundles resources", async () => {
    stubFetch([
      {
        match: "/v1/skills",
        method: "GET",
        json: {
          skills: [
            { name: "plain", description: "d", instructions: "i", scope: "global", source: "local", enabled: true, path: "/p", files: 0 },
            { name: "rich", description: "d", instructions: "i", scope: "global", source: "uploaded", enabled: true, path: "/r", files: 3 },
          ],
        },
      },
    ]);
    render(<SkillsTab />);
    fireEvent.click(screen.getByRole("button", { name: "我的" }));
    const note = await screen.findByTitle("显示文件夹");
    expect(note.textContent).toContain("3 个文件");
    // The one-file skill carries no count at all — only rich skills are marked.
    expect(screen.getAllByTitle("显示文件夹")).toHaveLength(1);
  });
});
