import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { usePresence, usePresentValue } from "@/hooks/usePresence";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-reduce-motion");
});

describe("usePresence", () => {
  it("mounts at once and leaves only after the exit hold", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 100), { initialProps: { open: true } });
    expect(result.current).toEqual({ mounted: true, leaving: false });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, leaving: true });
    act(() => void vi.advanceTimersByTime(99));
    expect(result.current.mounted).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });

  it("cancels the exit when reopened mid-way, so a quick reopen never unmounts a visible node", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 100), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => void vi.advanceTimersByTime(50));
    rerender({ open: true });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toEqual({ mounted: true, leaving: false });
  });

  it("skips the hold under reduced motion, since there is no animation to wait for", () => {
    document.documentElement.setAttribute("data-reduce-motion", "");
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 100), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });

  it("starts unmounted when closed, with nothing leaving", () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current).toEqual({ mounted: false, leaving: false });
  });
});

describe("usePresentValue", () => {
  it("keeps the last value through the exit and drops it once unmounted", () => {
    const { result, rerender } = renderHook(({ v }) => usePresentValue<string>(v, 100), {
      initialProps: { v: "card" as string | null },
    });
    expect(result.current.value).toBe("card");
    rerender({ v: null });
    expect(result.current.value).toBe("card");
    expect(result.current.leaving).toBe(true);
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current.value).toBeNull();
    expect(result.current.mounted).toBe(false);
  });
});
