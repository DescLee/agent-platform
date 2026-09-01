import { afterEach, expect, it, vi } from "vitest";
import { getPersonaCatalog } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("falls back to the public metadata index when the running sidecar lacks the catalog route", async () => {
  const request = vi.fn(async (url: string) => {
    if (url.includes("/v1/personas/catalog")) {
      return { ok: true, json: async () => ({ error: "unknown persona: catalog" }) } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        categories: [{ id: "06-ContentCreative", name: { zh: "内容创作" } }],
        experts: [
          { plugin: "writer", expertType: "agent", profession: { zh: "写作专家" }, categoryId: "06-ContentCreative" },
          { plugin: "writers", expertType: "team", profession: { zh: "写作团队" } },
        ],
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", request);

  const result = await getPersonaCatalog();

  expect(result.ok).toBe(true);
  expect(result.experts.map((expert) => expert.id)).toEqual(["wb-writer"]);
  expect(result.categories).toEqual([{ id: "06-ContentCreative", name: "内容创作", description: "" }]);
  expect(request).toHaveBeenCalledTimes(2);
});
