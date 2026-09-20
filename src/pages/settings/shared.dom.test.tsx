import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ExternalNote, Row, Toggle } from "./shared";

/** The settings row's shape, asserted instead of eyeballed, including the one difference from `Toggle`. */

describe("Row", () => {
  it("puts the label and hint on the left and the control on the right", () => {
    render(
      <Row label="settings.language" hint="settings.languageHint">
        <select data-testid="control" />
      </Row>,
    );
    const label = screen.getByText("settings.language");
    const control = screen.getByTestId("control");
    // The control is a sibling of the text block, which is what lets `justify-between` separate them.
    expect(label.parentElement).not.toContain(control);
    expect(screen.getByText("settings.languageHint")).toBeInTheDocument();
  });

  it("wraps everything in a label, so clicking the text reaches the control", () => {
    const { container } = render(
      <Row label="a">
        <select />
      </Row>,
    );
    expect(container.firstElementChild?.tagName).toBe("LABEL");
  });

  it("omits the hint element entirely when there is no hint", () => {
    // An empty span would add its line height and make hinted and unhinted rows different heights.
    const { container } = render(
      <Row label="a">
        <select />
      </Row>,
    );
    expect(container.querySelectorAll("span")).toHaveLength(2); // wrapper + label
  });

  it("renders a note below the hint when given one", () => {
    render(
      <Row label="a" hint="b" note={<ExternalNote>anilist only</ExternalNote>}>
        <select />
      </Row>,
    );
    expect(screen.getByText("anilist only")).toBeInTheDocument();
  });

  it("centres the control, where Toggle aligns to the first line", () => {
    // The one deliberate difference between the two, and why `Row` does not reuse `Toggle`'s container.
    const row = render(
      <Row label="a">
        <select />
      </Row>,
    );
    const rowLabel = row.container.firstElementChild!;
    expect(rowLabel.className).toContain("items-center");

    const toggle = render(<Toggle checked={false} onChange={() => {}} label="b" />);
    const toggleLabel = toggle.container.firstElementChild!;
    expect(toggleLabel.className).toContain("items-start");
  });
});

describe("Toggle", () => {
  it("is a switch with its state exposed, not a styled checkbox", () => {
    render(<Toggle checked onChange={() => {}} label="settings.reduceMotion" />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("reports unchecked as false rather than omitting the attribute", () => {
    render(<Toggle checked={false} onChange={() => {}} label="a" />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("disables the control and dims the row together", () => {
    // Both the switch and the label have to look unavailable, or only half of the row reads as disabled.
    const { container } = render(
      <Toggle checked={false} onChange={() => {}} label="a" hint="why" disabled />,
    );
    expect(screen.getByRole("switch")).toHaveProperty("disabled", true);
    expect(container.firstElementChild?.className).toContain("cursor-not-allowed");
  });
});

describe("ExternalNote", () => {
  it("carries an icon and the text, so it does not read as another hint", () => {
    const { container } = render(<ExternalNote>changes anilist.co</ExternalNote>);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("changes anilist.co")).toBeInTheDocument();
  });
});
