import { describe, expect, it } from "vitest";
import { pinchUpdate, zoomAboutPoint, type Point, type ZoomView } from "./zoomMath";

/** Where a content point c renders on screen under view v. */
const toScreen = (v: ZoomView, c: Point): Point => ({
  x: c.x * v.zoom + v.tx,
  y: c.y * v.zoom + v.ty,
});
/** Which content point is under screen point p. */
const toContent = (v: ZoomView, p: Point): Point => ({
  x: (p.x - v.tx) / v.zoom,
  y: (p.y - v.ty) / v.zoom,
});

describe("zoomAboutPoint", () => {
  it("keeps the content under the anchor exactly where it is", () => {
    const v: ZoomView = { tx: 12, ty: -30, zoom: 1.2 };
    const anchor = { x: 140, y: 90 };
    const before = toContent(v, anchor);
    const after = zoomAboutPoint(v, 1.5, anchor.x, anchor.y, 0.4, 4);
    expect(toScreen(after, before).x).toBeCloseTo(anchor.x);
    expect(toScreen(after, before).y).toBeCloseTo(anchor.y);
  });

  it("clamps at the bounds and returns the same view object at a wall", () => {
    const v: ZoomView = { tx: 0, ty: 0, zoom: 4 };
    expect(zoomAboutPoint(v, 2, 10, 10, 1, 4)).toBe(v);
    expect(zoomAboutPoint({ tx: 0, ty: 0, zoom: 1 }, 0.1, 0, 0, 1, 4).zoom).toBe(1);
  });
});

describe("pinchUpdate", () => {
  it("scales by the distance ratio and moves the old midpoint's content to the new one", () => {
    const v: ZoomView = { tx: 5, ty: 8, zoom: 1 };
    const prev: [Point, Point] = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
    const next: [Point, Point] = [{ x: 80, y: 110 }, { x: 280, y: 110 }];
    const under = toContent(v, { x: 150, y: 100 }); // old midpoint
    const after = pinchUpdate(v, prev, next, 0.4, 4);
    expect(after.zoom).toBeCloseTo(2); // 200px apart from 100px
    expect(toScreen(after, under).x).toBeCloseTo(180); // new midpoint
    expect(toScreen(after, under).y).toBeCloseTo(110);
  });

  it("a pure two-finger drag pans without zooming", () => {
    const v: ZoomView = { tx: 0, ty: 0, zoom: 2 };
    const prev: [Point, Point] = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const next: [Point, Point] = [{ x: 30, y: 40 }, { x: 130, y: 40 }];
    const after = pinchUpdate(v, prev, next, 0.4, 4);
    expect(after.zoom).toBe(2);
    expect(after.tx).toBeCloseTo(30);
    expect(after.ty).toBeCloseTo(40);
  });

  it("tolerates a degenerate zero-distance pair", () => {
    const v: ZoomView = { tx: 0, ty: 0, zoom: 1 };
    const p: [Point, Point] = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    const after = pinchUpdate(v, p, p, 0.4, 4);
    expect(after.zoom).toBe(1);
  });

  it("still tracks the midpoint when the scale hits the clamp", () => {
    const v: ZoomView = { tx: 0, ty: 0, zoom: 3.9 };
    const prev: [Point, Point] = [{ x: 100, y: 100 }, { x: 120, y: 100 }];
    const next: [Point, Point] = [{ x: 60, y: 100 }, { x: 180, y: 100 }];
    const under = toContent(v, { x: 110, y: 100 });
    const after = pinchUpdate(v, prev, next, 0.4, 4);
    expect(after.zoom).toBe(4);
    expect(toScreen(after, under).x).toBeCloseTo(120);
  });
});
