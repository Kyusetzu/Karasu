import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useGridRoving } from "./useGridRoving";

vi.mock("@/components/shell/KeyboardSheet", () => ({ isTyping: () => false }));

function Grid({ count, onOpen }: { count: number; onOpen: (i: number) => void }) {
  const { focus } = useGridRoving({ count, columns: 3, onOpen });
  return <output data-testid="focus">{focus === null ? "none" : focus}</output>;
}

const at = () => screen.getByTestId("focus").textContent;

describe("useGridRoving", () => {
  it("starts with nothing focused and moves on an arrow", () => {
    render(<Grid count={9} onOpen={vi.fn()} />);
    expect(at()).toBe("none");
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(at()).toBe("0");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(at()).toBe("1");
    // Three columns, so down is +3.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(at()).toBe("4");
  });

  it("opens the focused card on Enter, and nothing when there is none", () => {
    const onOpen = vi.fn();
    render(<Grid count={9} onOpen={onOpen} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(0);
  });

  /** A shrinking result set must pull the cursor back, or an index past the end hands `onOpen` an undefined card. */
  it("pulls the cursor back when the results shrink", () => {
    const { rerender } = render(<Grid count={9} onOpen={vi.fn()} />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(at()).toBe("6");

    rerender(<Grid count={2} onOpen={vi.fn()} />);
    expect(at()).toBe("1");

    rerender(<Grid count={0} onOpen={vi.fn()} />);
    expect(at()).toBe("none");
  });

  /** An overlay owns the keyboard while it is up — the same rule as the list. */
  it("stands down while an overlay is open", () => {
    render(<Grid count={9} onOpen={vi.fn()} />);
    const overlay = document.createElement("div");
    overlay.setAttribute("data-overlay", "");
    document.body.appendChild(overlay);

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(at()).toBe("none");

    overlay.remove();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(at()).toBe("0");
  });
});
