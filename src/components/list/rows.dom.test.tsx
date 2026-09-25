import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { entry, media } from "@/test/fixtures";
import { checkA11y } from "@/test/a11y";
import { PhoneRow } from "./PhoneRow";
import { ListRow } from "./ListRow";
import { GridCard } from "./GridCard";

/** The two row views the phone draws and the table's text variant, graded by axe and driven through their controls. */

const noop = () => {};

function phoneRow(over: Partial<Parameters<typeof PhoneRow>[0]> = {}) {
  return (
    <PhoneRow
      entry={entry()}
      variant="thumbs"
      unit="episodes"
      blurred={false}
      onPlusOne={noop}
      onEdit={noop}
      selectMode={false}
      selected={false}
      focused={false}
      onToggleSelect={noop}
      {...over}
    />
  );
}

describe("PhoneRow", () => {
  for (const variant of ["thumbs", "text"] as const) {
    it(`passes axe as ${variant}, browsing and selecting`, async () => {
      const browsing = renderWithProviders(phoneRow({ variant }));
      expect(await checkA11y(browsing.container)).toHaveNoViolations();
      browsing.unmount();
      const selecting = renderWithProviders(phoneRow({ variant, selectMode: true }));
      expect(await checkA11y(selecting.container)).toHaveNoViolations();
    });
  }

  it("draws a cover only in the thumbnail variant", () => {
    const { container, unmount } = renderWithProviders(phoneRow({ variant: "thumbs" }));
    expect(container.querySelector("img")).toBeInTheDocument();
    unmount();
    const text = renderWithProviders(phoneRow({ variant: "text" }));
    expect(text.container.querySelector("img")).toBeNull();
  });

  /** The long-press sheet finds a row by these, so they are the row's whole contract with `ActionHost`. */
  it("carries the identity the long press resolves", () => {
    const { container } = renderWithProviders(phoneRow());
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveAttribute("data-media-id", "1");
    expect(row).toHaveAttribute("data-media-type", "ANIME");
    expect(row).toHaveAttribute("data-media-title", "Cowboy Bebop");
  });

  it("puts progress first on the detail line", () => {
    renderWithProviders(phoneRow());
    expect(screen.getByText(/^4 \/ 26 episodes/)).toBeInTheDocument();
  });

  it("hands +1 and edit the entry, and hides both while selecting", () => {
    const onPlusOne = vi.fn();
    const onEdit = vi.fn();
    const { unmount } = renderWithProviders(phoneRow({ onPlusOne, onEdit }));
    fireEvent.click(screen.getByRole("button", { name: "common.plusOne" }));
    fireEvent.click(screen.getByRole("button", { name: "common.edit" }));
    expect(onPlusOne).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 1 }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 1 }));
    unmount();
    renderWithProviders(phoneRow({ selectMode: true }));
    expect(screen.queryByRole("button", { name: "common.plusOne" })).toBeNull();
  });

  it("toggles the selection on a tap anywhere while selecting", () => {
    const onToggleSelect = vi.fn();
    const { container } = renderWithProviders(phoneRow({ selectMode: true, onToggleSelect }));
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onToggleSelect).toHaveBeenCalledWith(1);
  });

  it("stops +1 at the final episode", () => {
    renderWithProviders(phoneRow({ entry: entry({ progress: 26 }) }));
    expect(screen.getByRole("button", { name: "common.plusOne" })).toBeDisabled();
  });

  it("reads chapters and volumes for manga", () => {
    const manga = media({ type: "MANGA", episodes: null, chapters: 120, volumes: 12 });
    renderWithProviders(phoneRow({ entry: entry({ progress: 30, progressVolumes: 3, media: manga }) }));
    expect(screen.getByText(/common\.progressChapters/)).toBeInTheDocument();
  });
});

describe("ListRow, text variant", () => {
  const row = (over: Partial<Parameters<typeof ListRow>[0]> = {}) => (
    <ListRow
      entry={entry()}
      tier="full"
      variant="text"
      blurred={false}
      onQuickSave={noop}
      onComplete={noop}
      onEdit={noop}
      selectMode={false}
      selected={false}
      focused={false}
      onToggleSelect={noop}
      {...over}
    />
  );

  it("passes axe with every control the thumbnail row has", async () => {
    const { container } = renderWithProviders(row());
    expect(await checkA11y(container)).toHaveNoViolations();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("combobox", { name: "common.status" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "common.progress" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common.complete" })).toBeInTheDocument();
  });

  it("collapses the cover track rather than removing it", () => {
    const { container } = renderWithProviders(row());
    const tracks = (container.firstElementChild as HTMLElement).style.gridTemplateColumns;
    expect(tracks.split(" ")[1]).toBe("0px");
  });

  it("saves a status change from its select", () => {
    const onQuickSave = vi.fn();
    renderWithProviders(row({ onQuickSave }));
    fireEvent.change(screen.getByRole("combobox", { name: "common.status" }), {
      target: { value: "COMPLETED" },
    });
    expect(onQuickSave).toHaveBeenCalledWith(expect.objectContaining({ mediaId: 1 }), {
      status: "COMPLETED",
    });
  });
});

function gridCard(over: Partial<Parameters<typeof GridCard>[0]> = {}) {
  return (
    <GridCard
      entry={entry()}
      unit="episodes"
      blurred={false}
      onPlusOne={noop}
      onComplete={noop}
      onEdit={noop}
      selectMode={false}
      selected={false}
      focused={false}
      onToggleSelect={noop}
      {...over}
    />
  );
}

/** The cover's frame clips, so what the ring and the quick actions do at its edges is a contract of its own. */
describe("GridCard", () => {
  it("rings the frame for the control that fills it, and never for the selection box", () => {
    const browsing = renderWithProviders(gridCard());
    expect(browsing.container.querySelector("a[data-fills-frame]")).toBeInTheDocument();
    browsing.unmount();
    renderWithProviders(gridCard({ selectMode: true }));
    expect(screen.getByRole("button", { name: "bulk.select" })).toHaveAttribute("data-fills-frame");
    expect(screen.getByRole("checkbox")).not.toHaveAttribute("data-fills-frame");
  });

  it("gives up complete on a narrow cover only when it would be the third circle", () => {
    const three = renderWithProviders(gridCard());
    expect(screen.getByRole("button", { name: "common.complete" })).toHaveClass("@max-cover-actions:hidden");
    expect(screen.getByRole("button", { name: "common.edit" })).toHaveClass("@max-cover-pair:hidden");
    three.unmount();
    // At its last episode but not completed: no +1, so edit and complete are the pair and complete stays.
    renderWithProviders(gridCard({ entry: entry({ progress: 26 }) }));
    expect(screen.queryByRole("button", { name: "common.plusOne" })).toBeNull();
    expect(screen.getByRole("button", { name: "common.complete" })).not.toHaveClass("@max-cover-actions:hidden");
    expect(screen.getByRole("button", { name: "common.edit" })).toHaveClass("not-pointer-coarse:@max-cover-pair:hidden");
  });
});
