import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Composer } from "./Composer";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(response: () => Promise<unknown>) {
  const fetch = vi.fn(async (url: string) => ({
    ok: true,
    json: () => url.endsWith("/auto-approve") ? response() : Promise.resolve({ auto_approve: false }),
  }));
  vi.stubGlobal("fetch", fetch);
  const onModeChange = vi.fn();
  const props = { mode: "interactive", model: "test", running: false, connected: true,
    workspace: "/test", sessionId: "first", onSend: vi.fn(), onInterrupt: vi.fn(),
    onModelChange: vi.fn(), onModeChange };
  const view = render(<Composer {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "权限模式" }));
  return { fetch, onModeChange, view, props };
}

it("offers delegate approval immediately after interactive, enabling it before switching", async () => {
  let finish!: (value: unknown) => void;
  const { fetch, onModeChange } = mount(() => new Promise((resolve) => { finish = resolve; }));
  const menu = within(screen.getByTestId("mode-menu"));
  expect(menu.getAllByRole("button")[2].textContent).toContain("替我审批");
  fireEvent.click(menu.getByRole("button", { name: /替我审批/ }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  expect(onModeChange).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/settings/auto-approve"),
    expect.objectContaining({ method: "POST", body: JSON.stringify({ auto_approve: true }) }));
  finish({ ok: true, auto_approve: true });
  await waitFor(() => expect(onModeChange).toHaveBeenCalledWith("auto-approve"));
});

it.each(["server", "network"])("keeps the previous mode after an enable %s failure", async (failure) => {
  const { onModeChange } = mount(async () => {
    if (failure === "network") throw new Error("offline");
    return { ok: false };
  });
  fireEvent.click(screen.getByRole("button", { name: /替我审批/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("已保留原权限模式");
  expect(onModeChange).not.toHaveBeenCalled();
});

it("does not apply a delayed permission switch to another session", async () => {
  let finish!: (value: unknown) => void;
  const { view, props, onModeChange } = mount(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: /替我审批/ }));
  await waitFor(() => expect(finish).toBeTypeOf("function"));
  view.rerender(<Composer {...props} sessionId="second" />);
  finish({ ok: true, auto_approve: true });
  // Open menu remains usable in the new session; the previous response may not switch it.
  fireEvent.click(screen.getByRole("button", { name: /仅对话和探索/ }));
  await waitFor(() => expect(screen.queryByTestId("mode-menu")).toBeNull());
  expect(onModeChange.mock.calls).toEqual([["discuss"]]);
});
