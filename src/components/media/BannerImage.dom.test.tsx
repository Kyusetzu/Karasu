import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { BannerImage } from "./BannerImage";

/** jsdom lays nothing out, so the frame's box is given here and the picture's shape arrives with its load event. */

const SRC = "https://s4.anilist.co/banner/1.jpg";

function frame(width: number, height: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => height });
}

function load(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
}

const bands = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>("[aria-hidden] > div")].filter((el) => el.style.backgroundImage.includes(SRC));
/** Which edge each band stretches; jsdom spells a one-word position out as two, so only the named edge is compared. */
const edges = (root: HTMLElement) =>
  bands(root).map((b) => b.style.backgroundPosition.split(" ").find((w) => w !== "center"));

beforeEach(() => frame(405, 173));
afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

describe("BannerImage", () => {
  it("draws a plain contained picture until it knows the picture's shape", () => {
    const { container } = render(<BannerImage src={SRC} />);
    const [, picture] = container.querySelectorAll("img");
    expect(picture).toHaveClass("object-contain");
    expect(bands(container)).toHaveLength(0);
  });

  /** The phone's header: a standard banner leaves a band above and below, and both of its edges fade into them. */
  it("fills the open sides with the picture's own edges once loaded, and feathers those edges", () => {
    const { container } = render(<BannerImage src={SRC} />);
    const [, picture] = container.querySelectorAll("img");
    load(picture, 1900, 400);
    expect(edges(container)).toEqual(["top", "bottom"]);
    // jsdom drops the default direction and spells #000 as rgb(), so the stops are what is compared.
    expect(picture.style.maskImage).toMatch(/^linear-gradient\((to bottom, )?transparent 43\.\d+px, .+ transparent 129\.\d+px\)$/);
  });

  it("opens the sides instead when the frame is wider than the banner", () => {
    frame(1712, 256);
    const { container } = render(<BannerImage src={SRC} />);
    load(container.querySelectorAll("img")[1], 1900, 400);
    expect(edges(container)).toEqual(["left", "right"]);
  });

  it("keeps the top edge sharp when the banner rests on it", () => {
    const { container } = render(<BannerImage src={SRC} anchor="top" />);
    const [, picture] = container.querySelectorAll("img");
    load(picture, 1900, 400);
    expect(edges(container)).toEqual(["bottom"]);
    expect(picture.style.maskImage).not.toMatch(/^linear-gradient\((to bottom, )?transparent/);
    expect(picture.style.maskImage).toMatch(/transparent 85\.\d+px\)$/);
  });

  /** Under the adult veil only the heavy blur may draw: no sharp picture, and no band that would sharpen its edge. */
  it("draws only the blur while veiled", () => {
    const { container } = render(<BannerImage src={SRC} veiled />);
    const images = container.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveClass("blur-2xl");
    expect(bands(container)).toHaveLength(0);
  });
});
