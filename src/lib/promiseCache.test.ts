import { describe, expect, it, vi } from "vitest";
import { createPromiseCache } from "./promiseCache";

describe("createPromiseCache", () => {
  it("calls the loader once for two concurrent gets of one key", async () => {
    const load = vi.fn((k: string) => Promise.resolve(`v:${k}`));
    const cache = createPromiseCache(load);
    const [a, b] = await Promise.all([cache.get("x"), cache.get("x")]);
    expect(a).toBe("v:x");
    expect(b).toBe("v:x");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not reload a settled key", async () => {
    const load = vi.fn((k: string) => Promise.resolve(k.length));
    const cache = createPromiseCache(load);
    await cache.get("abc");
    await cache.get("abc");
    expect(load).toHaveBeenCalledTimes(1);
    await cache.get("abcd");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps a rejection, so a refused host is not asked again", async () => {
    const load = vi.fn((_k: string) => Promise.reject(new Error("status")));
    const cache = createPromiseCache(load);
    await expect(cache.get("x")).rejects.toThrow("status");
    await expect(cache.get("x")).rejects.toThrow("status");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest key past the cap", async () => {
    const load = vi.fn((k: string) => Promise.resolve(k));
    const cache = createPromiseCache(load, 2);
    await cache.get("a");
    await cache.get("b");
    await cache.get("c");
    expect(cache.size).toBe(2);
    // `a` went; asking for it loads again, `c` is still held.
    await cache.get("a");
    expect(load).toHaveBeenCalledTimes(4);
    await cache.get("c");
    expect(load).toHaveBeenCalledTimes(4);
  });
});
