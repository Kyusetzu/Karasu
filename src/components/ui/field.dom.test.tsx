import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { checkA11y } from "@/test/a11y";
import { Field } from "./field";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";

/** A form's labelled controls, so every dialog names its fields and shows a hint or an error the same way. */
describe("Field", () => {
  it("names its control through the label, and shows the hint under it", () => {
    render(
      <Field label="Title" htmlFor="t" hint="Short and specific">
        <Input id="t" value="" onChange={vi.fn()} />
      </Field>,
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByText("Short and specific")).toHaveClass("text-ink-600");
  });

  it("lets the error stand in for the hint while there is one", () => {
    render(
      <Field label="Colour" htmlFor="c" hint="A name or a hex" error="Not a colour">
        <Input id="c" value="#12" onChange={vi.fn()} />
      </Field>,
    );
    expect(screen.getByText("Not a colour")).toHaveClass("text-danger");
    expect(screen.queryByText("A name or a hex")).toBeNull();
  });

  it("names a row of controls as a group where there is no one control to point at", () => {
    render(
      <Field label="Categories">
        <button type="button">General</button>
        <button type="button">News</button>
      </Field>,
    );
    expect(screen.getByRole("group", { name: "Categories" })).toContainElement(screen.getByRole("button", { name: "News" }));
  });

  it("gives a native choice and a long text the field's frame, named by their fields", async () => {
    const { container } = render(
      <>
        <Field label="Year" htmlFor="y">
          <Select id="y" value="2026" onChange={vi.fn()}>
            <option value="2026">2026</option>
          </Select>
        </Field>
        <Field label="Notes" htmlFor="n">
          <Textarea id="n" value="" onChange={vi.fn()} placeholder="Private notes" />
        </Field>
      </>,
    );
    expect(screen.getByRole("combobox", { name: "Year" })).toHaveClass("rounded-control", "border-surface-700");
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveClass("rounded-control", "placeholder:text-ink-600");
    expect(await checkA11y(container)).toHaveNoViolations();
  });
});
