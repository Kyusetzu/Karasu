import { afterEach, describe, expect, it, vi } from "vitest";
import { useContentFilter } from "@/stores/contentFilter";

const api = vi.hoisted(() => ({
  getContentFilter: vi.fn(() => Promise.resolve("moderate")),
  getBlurAdult: vi.fn(() => Promise.resolve(false)),
  setContentFilter: vi.fn(() => Promise.resolve()),
  setBlurAdult: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/api/anilist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/anilist")>()),
  ...api,
  isTauri: true,
}));

afterEach(() => {
  useContentFilter.setState({ level: "strict", blurAdult: true, ready: false, error: null });
  vi.clearAllMocks();
});

describe("content filter store", () => {
  it("starts strict and blurred, so nothing hidden can flash before the stored level is read", () => {
    const s = useContentFilter.getState();
    expect(s.level).toBe("strict");
    expect(s.blurAdult).toBe(true);
    expect(s.ready).toBe(false);
  });

  it("reads both stored settings at once and reports ready", async () => {
    await useContentFilter.getState().init();
    const s = useContentFilter.getState();
    expect(s.level).toBe("moderate");
    expect(s.blurAdult).toBe(false);
    expect(s.ready).toBe(true);
  });

  it("keeps the safe default when the read fails, and still reports ready so the app can draw", async () => {
    api.getContentFilter.mockRejectedValueOnce(new Error("db closed"));
    await useContentFilter.getState().init();
    const s = useContentFilter.getState();
    expect(s.level).toBe("strict");
    expect(s.ready).toBe(true);
  });

  it("paints the new level first and persists it after", async () => {
    const pending = useContentFilter.getState().setLevel("off");
    expect(useContentFilter.getState().level).toBe("off");
    await pending;
    expect(api.setContentFilter).toHaveBeenCalledWith("off");
    expect(useContentFilter.getState().error).toBeNull();
  });

  it("puts the level back and says why when persisting fails, rather than showing what the user asked not to see", async () => {
    api.setContentFilter.mockRejectedValueOnce(new Error("disk full"));
    await useContentFilter.getState().setLevel("off");
    const s = useContentFilter.getState();
    expect(s.level).toBe("strict");
    expect(s.error).toContain("disk full");
  });

  it("treats the blur switch the same way", async () => {
    api.setBlurAdult.mockRejectedValueOnce(new Error("no"));
    await useContentFilter.getState().setBlurAdult(false);
    expect(useContentFilter.getState().blurAdult).toBe(true);
    expect(useContentFilter.getState().error).toContain("no");
    await useContentFilter.getState().setBlurAdult(false);
    expect(useContentFilter.getState().blurAdult).toBe(false);
    expect(useContentFilter.getState().error).toBeNull();
  });
});
