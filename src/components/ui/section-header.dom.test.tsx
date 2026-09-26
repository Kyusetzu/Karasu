import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Play } from "lucide-react";
import { SectionHeader } from "./section-header";

/** The Overview's heading: the title never gives way to its meta line, and an action sits at the far end of the rule. */
describe("SectionHeader", () => {
  it("keeps the title whole and lets the meta line truncate", () => {
    render(<SectionHeader icon={Play} title="This week" meta="3 episodes across 3 shows air this week." />);
    expect(screen.getByRole("heading", { name: "This week" })).toHaveClass("shrink-0");
    expect(screen.getByText("3 episodes across 3 shows air this week.")).toHaveClass("min-w-0", "truncate");
  });

  it("puts an action after the rule, and nothing when there is none", () => {
    const { container, rerender } = render(<SectionHeader icon={Play} title="Continue" action={<a href="#/list">Show all</a>} />);
    const rule = container.querySelector(".section-rule");
    expect(rule?.nextElementSibling).toContainElement(screen.getByRole("link", { name: "Show all" }));
    rerender(<SectionHeader icon={Play} title="Continue" />);
    expect(container.querySelector(".section-rule")?.nextElementSibling).toBeNull();
  });
});
