import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PersonasTab } from "./PersonasTab";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PersonasTab", () => {
  it("shows the address-book loading page until both expert sources finish", async () => {
    let resolveIndex!: (value: Response) => void;
    let resolveCatalog!: (value: Response) => void;
    const index = new Promise<Response>((resolve) => { resolveIndex = resolve; });
    const catalog = new Promise<Response>((resolve) => { resolveCatalog = resolve; });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("/v1/personas/catalog") ? catalog : index));

    render(<PersonasTab />);
    expect(screen.getByText("正在翻找通讯库..")).toBeTruthy();
    expect(screen.queryByTestId("expert-grid")).toBeNull();

    resolveIndex({ json: async () => ({ personas: [], internal: false }) } as Response);
    await Promise.resolve();
    expect(screen.getByText("正在翻找通讯库..")).toBeTruthy();

    resolveCatalog({ json: async () => ({ ok: true, experts: [], categories: [] }) } as Response);
    expect(await screen.findByTestId("expert-list-scroll")).toBeTruthy();
    expect(screen.queryByTestId("experts-initial-loading")).toBeNull();
  });

  it("offers retry after seven seconds and starts a fresh load", async () => {
    vi.useFakeTimers();
    const never = new Promise<Response>(() => {});
    let indexCalls = 0;
    let catalogCalls = 0;
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/v1/personas/catalog")) {
        catalogCalls += 1;
        return catalogCalls === 1
          ? never
          : Promise.resolve({ json: async () => ({ ok: true, experts: [], categories: [] }) } as Response);
      }
      indexCalls += 1;
      return indexCalls === 1
        ? never
        : Promise.resolve({ json: async () => ({ personas: [], internal: false }) } as Response);
    }));

    render(<PersonasTab />);
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
    act(() => vi.advanceTimersByTime(7_000));
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(indexCalls).toBe(2);
    expect(catalogCalls).toBe(2);
    expect(screen.queryByTestId("experts-initial-loading")).toBeNull();
  });
});
