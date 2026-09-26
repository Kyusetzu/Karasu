import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Disclosure, DisclosurePanel } from "./disclosure";

/** The one fold: a button that says whether it is open, and a panel that grows in and stays through its exit. */
describe("Disclosure", () => {
  it("opens and closes its panel and points the button at it", async () => {
    const user = userEvent.setup({ delay: null });
    render(<Disclosure summary="Cast">Spike Spiegel</Disclosure>);
    const button = screen.getByRole("button", { name: "Cast" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Spike Spiegel")).not.toBeInTheDocument();

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!);
    expect(panel).toContainElement(screen.getByText("Spike Spiegel"));
    expect(panel).not.toHaveAttribute("data-instant");

    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("data-leaving");
    expect(panel).toHaveAttribute("inert");
    await waitFor(() => expect(screen.queryByText("Spike Spiegel")).not.toBeInTheDocument());
  });

  it("reports to a controlling caller and follows its state", async () => {
    const user = userEvent.setup({ delay: null });
    const seen: boolean[] = [];
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <Disclosure
          summary="Reviews"
          open={open}
          onOpenChange={(next) => {
            seen.push(next);
            setOpen(next);
          }}
        >
          body
        </Disclosure>
      );
    }
    render(<Host />);
    await user.click(screen.getByRole("button", { name: "Reviews" }));
    expect(seen).toEqual([true]);
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("appears without growing when it is open from the first render, and grows on a later opening", async () => {
    const { rerender } = render(<DisclosurePanel open id="p">replies</DisclosurePanel>);
    expect(document.getElementById("p")).toHaveAttribute("data-instant");
    rerender(<DisclosurePanel open={false} id="p">replies</DisclosurePanel>);
    await waitFor(() => expect(document.getElementById("p")).not.toBeInTheDocument());
    rerender(<DisclosurePanel open id="p">replies</DisclosurePanel>);
    expect(document.getElementById("p")).not.toHaveAttribute("data-instant");
  });
});
