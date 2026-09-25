import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useViewTransitions } from "./useViewTransitions";
import { renderWithProviders } from "@/test/render";

function Links() {
  useViewTransitions();
  return (
    <>
      {/* Stands in for a link that closes its overlay and navigates itself. */}
      <a href="#/user/own" data-own-navigation onClick={(e) => e.preventDefault()}>
        own
      </a>
      <a href="#/user/plain">plain</a>
    </>
  );
}

const start = vi.fn((update: () => void) => {
  update();
  return { ready: Promise.resolve(), finished: Promise.resolve() };
});

beforeEach(() => {
  Object.defineProperty(document, "startViewTransition", { value: start, configurable: true });
});
afterEach(() => {
  start.mockClear();
  Reflect.deleteProperty(document, "startViewTransition");
});

/** The document-level click hook that wraps in-app navigation in a View Transition. */
describe("useViewTransitions", () => {
  it("takes over a plain in-app link, and stands aside for one that navigates itself", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<Links />);
    await user.click(screen.getByText("own"));
    expect(start).not.toHaveBeenCalled();
    await user.click(screen.getByText("plain"));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
