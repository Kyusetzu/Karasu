import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { checkA11y } from "@/test/a11y";
import { Modal } from "./modal";

/** Every dialog renders through this one, so what it promises here is what every dialog in the app does. */
describe("Modal", () => {
  it("is a dialog named by its title that the X, Escape and the dim all close", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Presets" onClose={onClose}>
        <input aria-label="Name" />
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Presets" })).toHaveAttribute("aria-modal", "true");
    await user.click(screen.getByRole("button", { name: "window.close" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(container.querySelector("[data-overlay]")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("pins the footer under a body that scrolls on its own", () => {
    render(
      <Modal title="Edit" size="2xl" onClose={vi.fn()} footer={<button type="button">Save</button>}>
        <p>Body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Edit" });
    const body = screen.getByText("Body").parentElement!;
    expect(dialog).toHaveClass("max-w-2xl", "max-h-full");
    expect(body).toHaveClass("overflow-y-auto");
    expect(body).not.toContainElement(screen.getByRole("button", { name: "Save" }));
  });

  it("makes an alert interrupt: alertdialog above other dialogs, described by its body, answered only by its buttons", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const { container } = render(
      <Modal
        alert
        size="sm"
        title="Remove 3 entries?"
        onClose={onClose}
        footer={
          <>
            <button type="button">Cancel</button>
            <button type="button">Remove</button>
          </>
        }
      >
        <p>Cowboy Bebop</p>
      </Modal>,
    );
    const alert = screen.getByRole("alertdialog", { name: "Remove 3 entries?" });
    expect(alert).toHaveAccessibleDescription("Cowboy Bebop");
    expect(container.querySelector("[data-overlay]")).toHaveClass("z-alert");
    expect(screen.queryByRole("button", { name: "window.close" })).toBeNull();
    // The first answer takes the focus, so a stray Enter is the harmless one.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stands down while it may not be left: no X, and Escape and the dim do nothing", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    const { container } = render(
      <Modal title="Merging" onClose={onClose} dismissable={false}>
        <p>Working</p>
      </Modal>,
    );
    expect(screen.queryByRole("button", { name: "window.close" })).toBeNull();
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(container.querySelector("[data-overlay]")!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes only the dialog holding focus when one is open over another", async () => {
    const user = userEvent.setup({ delay: null });
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Modal title="Editor" onClose={outer}>
          <p>Form</p>
        </Modal>
        <Modal alert title="Discard?" onClose={inner} footer={<button type="button">Keep</button>}>
          <p>Unsaved</p>
        </Modal>
      </>,
    );
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });

  it("draws a bare dialog as the whole screen over the deep dim, named by its title", () => {
    const { container } = render(
      <Modal bare title="Cowboy Bebop" onClose={vi.fn()}>
        <button type="button">Zoom</button>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Cowboy Bebop" })).toHaveClass("size-full");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector("[data-overlay]")).toHaveClass("bg-scrim-deep");
  });

  it("ignores Escape once it is on its way out", async () => {
    const user = userEvent.setup({ delay: null });
    const onClose = vi.fn();
    render(
      <Modal title="Presets" onClose={onClose} leaving>
        <p>Body</p>
      </Modal>,
    );
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("passes axe as a dialog and as an alert", async () => {
    const { container } = render(
      <>
        <Modal title="Presets" onClose={vi.fn()} footer={<button type="button">Save</button>}>
          <p>Body</p>
        </Modal>
        <Modal alert title="Remove?" onClose={vi.fn()} footer={<button type="button">Remove</button>}>
          <p>Cowboy Bebop</p>
        </Modal>
      </>,
    );
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
