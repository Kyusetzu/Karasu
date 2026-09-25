import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Toast from "./Toast";
import { showToast, useToast } from "@/stores/toast";

const initial = useToast.getState();

afterEach(() => {
  act(() => useToast.getState().dismiss());
  useToast.setState({ pause: initial.pause, resume: initial.resume });
});

/** The receipt: spoken through one standing live region, held while it is being read, and dismissible. */
describe("Toast", () => {
  it("speaks through a live region that is there before the first receipt", () => {
    render(<Toast />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();
    act(() => showToast({ kind: "success", text: "Saved", detail: "Episode 8" }));
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Saved. Episode 8");
  });

  it("holds its clock while the pointer or the focus is on it", () => {
    const pause = vi.fn();
    const resume = vi.fn();
    useToast.setState({ pause, resume });
    render(<Toast />);
    act(() => showToast({ kind: "success", text: "Saved", action: { label: "Undo", run: () => {} } }));
    const undo = screen.getByRole("button", { name: "Undo" });
    const box = undo.parentElement!;
    fireEvent.pointerEnter(box);
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.pointerLeave(box);
    expect(resume).toHaveBeenCalledTimes(1);
    act(() => undo.focus());
    expect(pause).toHaveBeenCalledTimes(2);
    act(() => screen.getByRole("button", { name: "common.dismiss" }).focus());
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("runs its action once and goes, and goes on the dismiss button", async () => {
    const run = vi.fn();
    render(<Toast />);
    act(() => showToast({ kind: "success", text: "Set to 8", action: { label: "Undo", run } }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(run).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    act(() => showToast({ kind: "error", text: "Failed" }));
    fireEvent.click(await screen.findByRole("button", { name: "common.dismiss" }));
    await waitFor(() => expect(screen.queryByText("Failed", { selector: "span" })).toBeNull());
  });
});
