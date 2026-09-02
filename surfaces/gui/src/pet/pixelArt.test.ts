import { describe, expect, it } from "vitest";
import {
  BANNER_ART,
  BANNER_PALETTE,
  BANNER_TIRED_ART,
  HULK_ART,
  HULK_PALETTE,
  SURGE_ART,
  SURGE_PALETTE,
} from "./pixelArt";

const tokens = (art: string[]) => new Set(art.join("").replace(/\./g, "").split(""));

describe("pixel pet artwork", () => {
  it("keeps every form on the stable 32x40 grid", () => {
    for (const art of [BANNER_ART, BANNER_TIRED_ART, SURGE_ART, HULK_ART]) {
      expect(art).toHaveLength(40);
      expect(art.every((row) => row.length === 32)).toBe(true);
    }
  });

  it("has a palette entry for every visible token", () => {
    expect([...tokens(BANNER_ART)].every((token) => BANNER_PALETTE[token])).toBe(true);
    expect([...tokens(BANNER_TIRED_ART)].every((token) => BANNER_PALETTE[token])).toBe(true);
    expect([...tokens(SURGE_ART)].every((token) => SURGE_PALETTE[token])).toBe(true);
    expect([...tokens(HULK_ART)].every((token) => HULK_PALETTE[token])).toBe(true);
  });

  it("keeps the transformation and return cues distinct", () => {
    expect(SURGE_ART.join("")).toContain("G");
    expect(SURGE_ART.join("")).toContain("R");
    expect(BANNER_TIRED_ART.join("")).toContain("m");
    expect(HULK_ART.join("")).toContain("P");
  });

  it("keeps Hulk's angry brow, clenched teeth, and broader silhouette readable", () => {
    expect(HULK_ART.some((row) => row.includes("DDD"))).toBe(true);
    expect(HULK_ART.some((row) => row.includes("TTTT"))).toBe(true);
    expect(Math.max(...HULK_ART.map((row) => row.replace(/^\.+|\.+$/g, "").length)))
      .toBeGreaterThan(Math.max(...BANNER_ART.map((row) => row.replace(/^\.+|\.+$/g, "").length)));
  });
});
