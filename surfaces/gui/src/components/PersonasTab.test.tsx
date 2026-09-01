import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PersonasTab } from "./PersonasTab";

afterEach(() => {
  cleanup();
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
});
