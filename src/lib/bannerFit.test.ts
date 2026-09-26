import { describe, expect, it } from "vitest";
import { BANNER_RATIO, edgeBands, featherMask, fitBanner } from "./bannerFit";

describe("fitBanner", () => {
  /** The phone case: a standard banner is far wider than the header, so it fills the width and leaves bands above and below. */
  it("fills the width of a tall frame and centres the picture", () => {
    const fit = fitBanner({ width: 405, height: 173 }, BANNER_RATIO)!;
    expect(fit.image.width).toBe(405);
    expect(fit.image.height).toBeCloseTo(85.26, 1);
    expect(fit.image.top).toBeCloseTo(43.87, 1);
    expect(fit.gaps.top).toBeCloseTo(fit.gaps.bottom, 5);
    expect(fit.gaps.left).toBe(0);
    expect(fit.gaps.right).toBe(0);
  });

  /** The wide desktop case: the height binds, and the fill moves to the sides. */
  it("fills the height of a wide frame and leaves the sides open", () => {
    const fit = fitBanner({ width: 1712, height: 256 }, BANNER_RATIO)!;
    expect(fit.image.height).toBe(256);
    expect(fit.image.width).toBeCloseTo(1216, 0);
    expect(fit.gaps.left).toBeCloseTo(248, 0);
    expect(fit.gaps.right).toBeCloseTo(248, 0);
    expect(fit.gaps.top).toBe(0);
    expect(fit.gaps.bottom).toBe(0);
  });

  it("rests the picture on the top edge when asked, leaving the whole gap below", () => {
    const fit = fitBanner({ width: 373, height: 192 }, BANNER_RATIO, "top")!;
    expect(fit.image.top).toBe(0);
    expect(fit.gaps.top).toBe(0);
    expect(fit.gaps.bottom).toBeCloseTo(192 - 373 / BANNER_RATIO, 5);
  });

  /** A frame that matches the banner to the pixel must not grow a hairline band from rounding. */
  it("treats a sub-pixel remainder as no gap at all", () => {
    const fit = fitBanner({ width: 1232, height: 259.2 }, BANNER_RATIO)!;
    expect(fit.gaps).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("answers nothing for a frame not yet measured or a picture not yet loaded", () => {
    expect(fitBanner({ width: 0, height: 200 }, BANNER_RATIO)).toBeNull();
    expect(fitBanner({ width: 400, height: 200 }, 0)).toBeNull();
    expect(fitBanner({ width: 400, height: 200 }, Number.NaN)).toBeNull();
  });
});

describe("edgeBands", () => {
  it("draws one band per open side, tucked under the picture by the lap", () => {
    const fit = fitBanner({ width: 405, height: 173 }, BANNER_RATIO)!;
    const bands = edgeBands(fit, 10);
    expect(bands.map((b) => b.side)).toEqual(["top", "bottom"]);
    const [top, bottom] = bands;
    expect(top.rect.top).toBe(0);
    expect(top.rect.height).toBeCloseTo(fit.gaps.top + 10, 5);
    expect(bottom.rect.top).toBeCloseTo(fit.image.top + fit.image.height - 10, 5);
    expect(bottom.rect.top + bottom.rect.height).toBeCloseTo(173, 5);
    expect(top.rect.width).toBe(405);
  });

  it("uses side bands when the height binds", () => {
    const bands = edgeBands(fitBanner({ width: 1712, height: 256 }, BANNER_RATIO)!, 10);
    expect(bands.map((b) => b.side)).toEqual(["left", "right"]);
    expect(bands[1].rect.left + bands[1].rect.width).toBeCloseTo(1712, 5);
  });

  it("draws nothing for a picture that fills its frame", () => {
    expect(edgeBands(fitBanner({ width: 1232, height: 259.2 }, BANNER_RATIO)!, 10)).toEqual([]);
  });
});

describe("featherMask", () => {
  it("fades only the edges that meet a fill", () => {
    const top = fitBanner({ width: 373, height: 192 }, BANNER_RATIO, "top")!;
    const mask = featherMask(top, 14)!;
    expect(mask.startsWith("linear-gradient(to bottom, #000 0px")).toBe(true);
    expect(mask).toMatch(/transparent 78\.\d+px\)$/);
  });

  it("fades the sides of a height-bound picture", () => {
    const mask = featherMask(fitBanner({ width: 1712, height: 256 }, BANNER_RATIO)!, 14)!;
    expect(mask).toMatch(/^linear-gradient\(to right, transparent 248px, #000 262px, #000 1450px, transparent 1464px\)$/);
  });

  it("leaves a picture that fills its frame unmasked", () => {
    expect(featherMask(fitBanner({ width: 1232, height: 259.2 }, BANNER_RATIO)!, 14)).toBeNull();
  });
});
