import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "./pill";

/** A pill is the accent's tint when chosen, unless it stands for a colour of its own, as a status does. */
describe("Pill", () => {
  it("takes the accent as its tint when chosen and draws no dot", () => {
    render(<Pill active>Anime</Pill>);
    const pill = screen.getByRole("button", { name: "Anime" });
    expect(pill).toHaveAttribute("aria-pressed", "true");
    expect(pill).toHaveClass("tint-fill", "tint-accent");
    expect(pill.querySelector("span[aria-hidden]")).toBeNull();
  });

  it("carries a status's own colour as its dot and its tint, never the accent", () => {
    render(
      <>
        <Pill active tint="var(--color-status-current)">Watching</Pill>
        <Pill tint="var(--color-status-paused)">Paused</Pill>
      </>,
    );
    const chosen = screen.getByRole("button", { name: "Watching" });
    expect(chosen).toHaveClass("tint-fill");
    expect(chosen).not.toHaveClass("tint-accent");
    expect(chosen.style.getPropertyValue("--tint")).toBe("var(--color-status-current)");
    // The dot shows on every choice, so the colour is legible before one is picked.
    const other = screen.getByRole("button", { name: "Paused" });
    expect(other.querySelector("span[aria-hidden]")).toHaveStyle({ backgroundColor: "var(--color-status-paused)" });
    expect(other).not.toHaveClass("tint-fill");
  });
});
