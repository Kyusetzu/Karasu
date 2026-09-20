import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NewThreadModal } from "./NewThreadModal";
import { renderWithProviders } from "@/test/render";

/** Proves the modal asks `validateThread` before enabling create; the one enabled state is asserted, never pressed. */

const createButton = () =>
  screen.getAllByRole("button").find((b) => b.textContent?.includes("forum.create") &&
    !b.textContent.includes("forum.creating")) as HTMLButtonElement;

const user = userEvent.setup({ delay: null });

/** Typed, not set: the field hears the same focus, key and input sequence a person causes. */
async function fill({ title, body, category }: { title?: string; body?: string; category?: string }) {
  if (title !== undefined) {
    const el = screen.getByLabelText("forum.threadTitleLabel");
    await user.clear(el);
    await user.type(el, title);
  }
  if (body !== undefined) {
    const el = screen.getByLabelText("forum.bodyLabel");
    await user.clear(el);
    await user.type(el, body);
  }
  if (category !== undefined) {
    await user.click(screen.getByRole("button", { name: category }));
  }
}

describe("NewThreadModal", () => {
  it("disables create until title, body and a category are all present", async () => {
    renderWithProviders(<NewThreadModal onClose={() => {}} />);
    expect(createButton()).toBeDisabled();

    await fill({ title: "Weekly chapter talk" });
    expect(createButton()).toBeDisabled();

    await fill({ body: "So, that ending." });
    expect(createButton()).toBeDisabled();

    await fill({ category: "General" });
    expect(createButton()).toBeEnabled();
  });

  it("re-disables when the category is toggled back off", async () => {
    renderWithProviders(<NewThreadModal onClose={() => {}} />);
    await fill({ title: "t", body: "b", category: "General" });
    expect(createButton()).toBeEnabled();

    await fill({ category: "General" });
    expect(createButton()).toBeDisabled();
  });

  it("a whitespace title does not count as one", async () => {
    renderWithProviders(<NewThreadModal onClose={() => {}} />);
    await fill({ title: "   ", body: "b", category: "General" });
    expect(createButton()).toBeDisabled();
  });
});
