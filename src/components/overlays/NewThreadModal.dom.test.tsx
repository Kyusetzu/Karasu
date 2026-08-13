import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewThreadModal } from "./NewThreadModal";
import { renderWithProviders } from "@/test/render";

/**
 * The gate on the create button. `lib/composer.test.ts` proves `validateThread`
 * itself; this proves the modal actually asks it — a thread needs a title, a
 * body and at least one category before the button will send anything.
 *
 * The mutation is never fired here: everything below stops short of an enabled
 * click, and the one enabled state is asserted, not pressed.
 */

const createButton = () =>
  screen.getAllByRole("button").find((b) => b.textContent?.includes("forum.create") &&
    !b.textContent.includes("forum.creating")) as HTMLButtonElement;

function fill({ title, body, category }: { title?: string; body?: string; category?: string }) {
  if (title !== undefined) {
    fireEvent.change(screen.getByLabelText("forum.threadTitleLabel"), {
      target: { value: title },
    });
  }
  if (body !== undefined) {
    fireEvent.change(screen.getByLabelText("forum.bodyLabel"), { target: { value: body } });
  }
  if (category !== undefined) {
    fireEvent.click(screen.getByRole("button", { name: category }));
  }
}

describe("NewThreadModal", () => {
  it("disables create until title, body and a category are all present", () => {
    renderWithProviders(<NewThreadModal onClose={() => {}} />);
    expect(createButton().disabled).toBe(true);

    fill({ title: "Weekly chapter talk" });
    expect(createButton().disabled).toBe(true);

    fill({ body: "So, that ending." });
    expect(createButton().disabled).toBe(true);

    fill({ category: "General" });
    expect(createButton().disabled).toBe(false);
  });

  it("re-disables when the category is toggled back off", () => {
    renderWithProviders(<NewThreadModal onClose={() => {}} />);
    fill({ title: "t", body: "b", category: "General" });
    expect(createButton().disabled).toBe(false);

    fill({ category: "General" });
    expect(createButton().disabled).toBe(true);
  });

  it("a whitespace title does not count as one", () => {
    renderWithProviders(<NewThreadModal onClose={() => {}} />);
    fill({ title: "   ", body: "b", category: "General" });
    expect(createButton().disabled).toBe(true);
  });
});
