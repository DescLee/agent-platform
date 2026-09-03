// SKILLS-SPEC §4.6 GUI — the composer's "/" force-run popup: opens only for a leading
// slash, lists only the session's effective (enabled) menu, filters while typing, and the
// picked skill rides onSend as its own field — never as message text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as attachmentsApi from "../attach";
import { Composer } from "./Composer";
import { greenboatSummaryPrompt } from "../greenboatReport";

const MENU = {
  skills: [
    { name: "weekly-report", description: "Monday status report", scope: "global", enabled: true },
    { name: "greet", description: "says hello", scope: "project", enabled: true },
    { name: "muted-one", description: "muted here", scope: "global", enabled: false },
    { name: "dev-expert", description: "编程专家.Skill P8级编程助手,覆盖很多能力", scope: "global", enabled: true },
  ],
};

function stubFetch() {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: (init?.method || "GET").toUpperCase() });
      if (url.includes("/skills")) return { ok: true, json: async () => MENU } as Response;
      return { ok: true, json: async () => ({}) } as Response;
    }),
  );
  return calls;
}

const props = (extra: Partial<Parameters<typeof Composer>[0]> = {}) => ({
  mode: "interactive",
  model: "gpt-5.6-sol",
  running: false,
  connected: true,
  sessionId: "s1",
  onSend: vi.fn(),
  onInterrupt: vi.fn(),
  onModeChange: vi.fn(),
  onModelChange: vi.fn(),
  ...extra,
});

const box = () => screen.getByPlaceholderText(/告诉绿巨人/);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Composer / skills popup", () => {
  it("preserves the edited draft across folder reconnects but clears it for a new conversation", () => {
    stubFetch();
    const p = props({ sessionId: "s1", resetKey: "s1", workspace: "/first", prefill: {
      nonce: 1, text: "initial", skill: { name: "greet" },
      attachments: [{ kind: "text", name: "notes.md", text: "notes" }],
    } });
    const view = render(<Composer {...p} />);
    fireEvent.change(box(), { target: { value: "my unfinished edits" } });
    for (const [sessionId, workspace] of [["s2", "/second"], ["s3", "/third"]]) {
      view.rerender(<Composer {...p} sessionId={sessionId} workspace={workspace} />);
      expect((box() as HTMLTextAreaElement).value).toBe("my unfinished edits");
      expect(screen.getByText("notes.md")).toBeTruthy();
      expect(screen.getByTestId("selected-skill")).toBeTruthy();
    }
    view.rerender(<Composer {...p} sessionId="s4" resetKey="s4" prefill={{ nonce: 2, text: "", targetSessionId: "s4" }} />);
    expect((box() as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText("notes.md")).toBeNull();
    expect(screen.queryByTestId("selected-skill")).toBeNull();
  });

  it("clears text, uploaded/referenced files and the skill on each new draft, including remounts", () => {
    stubFetch();
    const p = props({ resetKey: "s1", prefill: {
      nonce: 1, text: "unfinished draft", skill: { name: "greet" },
      attachments: [
        { kind: "text", name: "upload.md", text: "upload" },
        { kind: "text", name: "reference.md", text: "reference", knowledge_ref: "file-1" },
      ],
    } });
    const view = render(<Composer {...p} />);
    expect(screen.getByTestId("selected-skill")).toBeTruthy();
    expect(screen.getByText("upload.md")).toBeTruthy();
    expect(screen.getByText("reference.md")).toBeTruthy();
    const fresh = props({ sessionId: "s2", resetKey: "s2", prefill: { nonce: 2, text: "", targetSessionId: "s2" } });
    view.rerender(<Composer {...fresh} />);
    const assertEmpty = () => {
      expect((box() as HTMLTextAreaElement).value).toBe("");
      expect(screen.queryByTestId("selected-skill")).toBeNull();
      expect(screen.queryByText("upload.md")).toBeNull();
      expect(screen.queryByText("reference.md")).toBeNull();
    };
    assertEmpty();
    view.unmount();
    const remounted = render(<Composer {...fresh} />);
    assertEmpty();
    fireEvent.change(box(), { target: { value: "another draft" } });
    remounted.rerender(<Composer {...fresh} sessionId="s3" resetKey="s3" prefill={{ nonce: 3, text: "", targetSessionId: "s3" }} />);
    assertEmpty();
  });

  it("does not attach an upload that finishes after starting a new draft", async () => {
    stubFetch();
    let complete!: (value: Awaited<ReturnType<typeof attachmentsApi.readFile>>) => void;
    vi.spyOn(attachmentsApi, "readFile").mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const p = props({ resetKey: "s1" });
    const view = render(<Composer {...p} />);
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(["old"], "late.md", { type: "text/plain" })] },
    });
    view.rerender(<Composer {...p} sessionId="s2" resetKey="s2" />);
    await act(async () => { complete({ kind: "text", name: "late.md", text: "old" }); });
    expect(screen.queryByText("late.md")).toBeNull();
    expect((box() as HTMLTextAreaElement).value).toBe("");
  });

  it("keeps the Greenboat file and prompt when StrictMode replays mount effects", async () => {
    stubFetch();
    const attachment = { kind: "file" as const, name: "今日消息.md", path: "/scratch/s1/今日消息.md", mime: "text/markdown" };
    const prefill = { nonce: 1, targetSessionId: "s1", text: greenboatSummaryPrompt("2026-09-03", attachment.name), attachments: [attachment] };
    const p = props({ resetKey: "s1", prefill });
    render(<StrictMode><Composer {...p} /></StrictMode>);
    expect((box() as HTMLTextAreaElement).value).toBe(prefill.text);
    expect(screen.getAllByText(attachment.name)).toHaveLength(1);
    expect(p.onSend).not.toHaveBeenCalled();
  });
  it("waits for the target session reset before applying the Greenboat file and fixed prompt", async () => {
    stubFetch();
    const attachment = { kind: "file" as const, name: "今日消息.md", path: "/scratch/s2/今日消息.md", mime: "text/markdown" };
    const prefill = { nonce: 1, targetSessionId: "s2", text: greenboatSummaryPrompt("2026-09-03", attachment.name), attachments: [attachment] };
    const p = props({ sessionId: "s1", resetKey: "s1", prefill });
    const { rerender } = render(<Composer {...p} />);
    expect((box() as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(attachment.name)).toBeNull();
    rerender(<Composer {...p} sessionId="s2" />);
    expect((box() as HTMLTextAreaElement).value).toBe("");
    rerender(<Composer {...p} sessionId="s2" resetKey="s2" />);
    expect(await screen.findByText(attachment.name)).toBeTruthy();
    expect((box() as HTMLTextAreaElement).value).toBe(prefill.text);
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.change(box(), { target: { value: "用户编辑" } });
    rerender(<Composer {...p} sessionId="s2" resetKey="s2" connected={false} />);
    expect((box() as HTMLTextAreaElement).value).toBe("用户编辑");
    rerender(<Composer {...p} sessionId="s3" resetKey="s3" />);
    expect((box() as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByText(attachment.name)).toBeNull();
  });
  it("prefills a real workspace file chip with only the prompt in the text box", async () => {
    stubFetch();
    const attachment = { kind: "file" as const, name: "今日消息.md", path: "/scratch/s1/今日消息.md", mime: "text/markdown" };
    const p = props({ resetKey: "s1", prefill: { nonce: 1, text: "总结今日已读、未读和@我的事项", attachments: [attachment] } });
    render(<Composer {...p} />);
    expect(await screen.findByText("今日消息.md")).toBeTruthy();
    expect((box() as HTMLTextAreaElement).value).toBe(p.prefill!.text);
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(p.onSend).toHaveBeenCalledWith(p.prefill!.text, [attachment], undefined));
    expect(vi.mocked(p.onSend).mock.calls[0][1]?.[0].text).toBeUndefined();
  });
  it("opens on a leading '/' and lists only enabled skills from the effective menu", async () => {
    stubFetch();
    render(<Composer {...props()} />);
    fireEvent.change(box(), { target: { value: "/" } });
    await screen.findByTestId("skill-popup");
    expect(await screen.findByText("/weekly-report")).toBeTruthy();
    expect(screen.getByText("/greet")).toBeTruthy();
    expect(screen.queryByText("/muted-one")).toBeNull(); // muted → not offered
    expect(screen.queryByText("project")).toBeNull();
    expect(screen.getByText("编程专家.Skill")).toBeTruthy();
    expect(screen.queryByText(/P8级编程助手/)).toBeNull();
  });

  it("filters as you type", async () => {
    stubFetch();
    render(<Composer {...props()} />);
    fireEvent.change(box(), { target: { value: "/" } });
    await screen.findByRole("option", { name: "/weekly-report" });
    fireEvent.change(box(), { target: { value: "/wee" } });
    expect(screen.getByRole("option", { name: "/weekly-report" })).toBeTruthy();
    expect(screen.queryByText("/greet")).toBeNull();
  });

  it("filters by the Chinese display name and highlights only the matching text", async () => {
    stubFetch();
    render(<Composer {...props()} />);
    fireEvent.change(box(), { target: { value: "/编程" } });
    const match = await screen.findByText("编程");
    expect(match.className).toContain("text-accent");
    expect(screen.getByText("专家.Skill").className).toContain("text-ink");
    expect(screen.queryByText("/greet")).toBeNull();
  });

  it("does NOT open for a mid-text slash", async () => {
    stubFetch();
    render(<Composer {...props()} />);
    fireEvent.change(box(), { target: { value: "rate 5/10 please" } });
    expect(screen.queryByTestId("skill-popup")).toBeNull();
  });

  it("selecting shows a removable skill chip and carries the skill field", async () => {
    stubFetch();
    const p = props();
    render(<Composer {...p} />);
    fireEvent.change(box(), { target: { value: "/gr" } });
    fireEvent.click(await screen.findByRole("option", { name: /greet/ }));
    expect((box() as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByTestId("selected-skill").textContent).toContain("greet");
    fireEvent.change(box(), { target: { value: "say hi to the team" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(p.onSend).toHaveBeenCalled());
    expect(p.onSend).toHaveBeenCalledWith("say hi to the team", [], "greet");
  });

  it("a skill-only send works and Enter inside the popup never sends the query text", async () => {
    stubFetch();
    const p = props();
    render(<Composer {...p} />);
    fireEvent.change(box(), { target: { value: "/wee" } });
    await screen.findByRole("option", { name: "/weekly-report" });
    fireEvent.keyDown(box(), { key: "Enter" }); // selects, does not send
    expect(p.onSend).not.toHaveBeenCalled();
    expect((box() as HTMLTextAreaElement).value).toBe("");
    fireEvent.keyDown(box(), { key: "Enter" }); // now sends, skill-only
    await waitFor(() => expect(p.onSend).toHaveBeenCalledWith("", [], "weekly-report"));
  });

  it("the chip close button un-picks the skill", async () => {
    stubFetch();
    const p = props();
    render(<Composer {...p} />);
    fireEvent.change(box(), { target: { value: "/gr" } });
    fireEvent.click(await screen.findByRole("option", { name: /greet/ }));
    fireEvent.click(screen.getByRole("button", { name: "移除技能 greet" }));
    fireEvent.change(box(), { target: { value: "hello plain" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(p.onSend).toHaveBeenCalledWith("hello plain", [], undefined));
  });

  it("Escape closes the popup and no popup ever opens without a sessionId", async () => {
    stubFetch();
    render(<Composer {...props()} />);
    fireEvent.change(box(), { target: { value: "/gr" } });
    await screen.findByTestId("skill-popup");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByTestId("skill-popup")).toBeNull();
    cleanup();
    stubFetch();
    render(<Composer {...props({ sessionId: undefined })} />);
    fireEvent.change(box(), { target: { value: "/" } });
    expect(screen.queryByTestId("skill-popup")).toBeNull();
  });
});

describe("Composer — the doorway prefill (SKILLS-SPEC §5.2)", () => {
  it("a prefill arriving together with a session switch survives the draft clear", async () => {
    stubFetch();
    const { rerender } = render(<Composer {...props({ resetKey: "s1" })} />);
    // The doorway does both in one render: new session (resetKey) + prefill. The clear
    // effect must run BEFORE the prefill effect or the prefill is wiped (regression).
    rerender(
      <Composer
        {...props({
          resetKey: "s2",
          prefill: { text: "Build a new skill for me: release procedure", nonce: 1 },
        })}
      />,
    );
    await waitFor(() => {
      expect((box() as HTMLTextAreaElement).value).toBe(
        "Build a new skill for me: release procedure",
      );
    });
  });

  it("renders a prefilled skill with its Chinese label and allows removing it", async () => {
    stubFetch();
    const p = props({
      prefill: { text: "", skill: { name: "dev-expert", label: "编程专家" }, nonce: 1 },
    });
    render(<Composer {...p} />);
    expect(await screen.findByText("编程专家")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "移除技能 编程专家" }));
    fireEvent.change(box(), { target: { value: "检查代码" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(p.onSend).toHaveBeenCalledWith("检查代码", [], undefined));
  });
});
