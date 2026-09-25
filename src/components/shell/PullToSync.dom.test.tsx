import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PULL_IDLE, PULL_TRIGGER_PX, type PullState } from "@/lib/pullToSync";

const pull = vi.hoisted(() => ({ state: null as PullState | null, syncing: false }));

vi.mock("@/hooks/usePullToSync", async () => {
  const { PULL_IDLE: idle } = await vi.importActual<typeof import("@/lib/pullToSync")>("@/lib/pullToSync");
  return { usePullToSync: () => ({ state: pull.state ?? idle, syncing: pull.syncing, available: true }) };
});

import PullToSync from "./PullToSync";

const outer = () => screen.getByRole("status").parentElement as HTMLElement;

afterEach(() => {
  pull.state = null;
  pull.syncing = false;
});

/** The pill leaves where it stood: the state it drew has already reset by the time its exit renders. */
describe("the pull indicator's exit", () => {
  it("fades a released pull out at the depth it reached", () => {
    pull.state = { phase: "pulling", offset: 40, startY: 0, startX: 0 };
    const { rerender } = render(<PullToSync />);
    expect(outer().style.transform).toBe("translateY(40px)");
    pull.state = PULL_IDLE;
    rerender(<PullToSync />);
    expect(outer().style.transform).toBe("translateY(40px)");
    expect(screen.getByRole("status")).toHaveClass("animate-fade-out");
    expect(screen.getByRole("status")).toHaveTextContent("pull.hint");
  });

  it("fades a finished sync out at the threshold, still saying it synced", () => {
    pull.syncing = true;
    const { rerender } = render(<PullToSync />);
    expect(outer().style.transform).toBe(`translateY(${PULL_TRIGGER_PX}px)`);
    pull.syncing = false;
    rerender(<PullToSync />);
    expect(outer().style.transform).toBe(`translateY(${PULL_TRIGGER_PX}px)`);
    expect(screen.getByRole("status")).toHaveTextContent("pull.syncing");
    expect(screen.getByRole("status")).toHaveClass("text-accent-400");
  });
});
