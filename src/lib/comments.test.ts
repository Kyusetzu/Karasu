import { describe, expect, it } from "vitest";
import { flattenComments, visibleAnchor } from "./comments";

const USER = { id: 1, name: "kyu", avatar: { medium: "x" } };

const c = (id: number, kids?: unknown) => ({
  id,
  comment: `c${id}`,
  createdAt: id,
  likeCount: 0,
  isLiked: false,
  siteUrl: `https://anilist.co/c/${id}`,
  user: USER,
  childComments: kids ?? null,
});

describe("flattenComments", () => {
  it("keeps top-level comments in order", () => {
    const out = flattenComments([c(1), c(2), c(3)]);
    expect(out.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(out.every((x) => x.depth === 0)).toBe(true);
  });

  it("puts each reply directly after its parent", () => {
    const out = flattenComments([c(1, [c(11), c(12)]), c(2)]);
    expect(out.map((x) => x.id)).toEqual([1, 11, 12, 2]);
    expect(out.map((x) => x.depth)).toEqual([0, 1, 1, 0]);
  });

  it("flattens at two levels and counts what it hides", () => {
    // The real shape: thread 12753 nests 48 deep. Two levels render; the rest
    // is reported as a number so the conversation is not silently lost.
    const deep = c(1, [c(11, [c(111, [c(1111)])])]);
    const out = flattenComments([deep]);
    expect(out.map((x) => x.id)).toEqual([1, 11]);
    // Two descendants below the visible reply.
    expect(out[1].hiddenReplies).toBe(2);
    expect(out[0].hiddenReplies).toBe(2);
  });

  it("reports nothing hidden when the chain stops at one level", () => {
    const out = flattenComments([c(1, [c(11), c(12)])]);
    expect(out[0].hiddenReplies).toBe(0);
    expect(out[1].hiddenReplies).toBe(0);
  });

  it("treats a null childComments as no replies — AniList's own default", () => {
    // Observed live: comments with no children return null, not [].
    const out = flattenComments([c(1, null)]);
    expect(out).toHaveLength(1);
    expect(out[0].hiddenReplies).toBe(0);
  });

  it("yields [] for anything that is not a list, rather than throwing", () => {
    // `childComments` is an untyped Json scalar, so "unexpected" is normal.
    for (const bad of [null, undefined, {}, 42, "nope", true]) {
      expect(flattenComments(bad), JSON.stringify(bad)).toEqual([]);
    }
  });

  it("survives garbage inside the blob", () => {
    const out = flattenComments([
      c(1, ["a string", null, 42, {}, { id: "not a number" }, c(11)]),
      null,
      "junk",
      { noId: true },
      c(2, "not an array"),
    ]);
    // Only the well-formed pieces survive, and nothing throws.
    expect(out.map((x) => x.id)).toEqual([1, 11, 2]);
  });

  it("defaults missing scalars rather than passing undefined to the UI", () => {
    const out = flattenComments([{ id: 5 }]);
    expect(out[0]).toMatchObject({
      id: 5,
      comment: "",
      createdAt: 0,
      likeCount: 0,
      isLiked: false,
      siteUrl: "",
      user: null,
      depth: 0,
    });
  });

  it("keeps a usable user and rejects an unusable one", () => {
    expect(flattenComments([{ id: 1, user: USER }])[0].user).toMatchObject({
      id: 1,
      name: "kyu",
    });
    for (const bad of [null, {}, { id: 1 }, { name: "x" }, "nope"]) {
      expect(flattenComments([{ id: 2, user: bad }])[0].user).toBeNull();
    }
  });

  it("terminates on a deeply nested blob", () => {
    // 5,000 levels. `countDescendants` recurses, so this is the assertion that
    // it cannot blow the stack on a pathological chain.
    let node: unknown = c(0);
    for (let i = 1; i < 5000; i++) node = c(i, [node]);
    expect(() => flattenComments([node])).not.toThrow();
    expect(flattenComments([node])).toHaveLength(2);
  });
});

describe("rootId", () => {
  /**
   * The bug this exists for: a reply parented to a *reply* becomes a depth-2
   * comment, which the flatten folds into `hiddenReplies` and never renders.
   * The post succeeds and disappears. Every row must therefore name the
   * top-level comment it hangs off, not itself.
   */
  it("points every reply at its top-level comment", () => {
    const flat = flattenComments([
      {
        id: 1,
        comment: "top",
        childComments: [
          { id: 2, comment: "reply", childComments: [] },
          { id: 3, comment: "another", childComments: [] },
        ],
      },
    ]);
    expect(flat.map((c) => [c.id, c.depth, c.rootId])).toEqual([
      [1, 0, 1],
      [2, 1, 1],
      [3, 1, 1],
    ]);
  });

  it("makes a top-level comment its own root", () => {
    const flat = flattenComments([{ id: 9, comment: "alone" }]);
    expect(flat[0].rootId).toBe(9);
  });

  /** A row that reached `normalize` by any other path is never parentless. */
  it("never leaves rootId unset", () => {
    const flat = flattenComments([
      { id: 4, comment: "a", childComments: [{ id: 5, comment: "b" }] },
    ]);
    expect(flat.every((c) => typeof c.rootId === "number" && c.rootId > 0)).toBe(true);
  });
});


describe("visibleAnchor", () => {
  it("finds a top-level target exactly", () => {
    expect(visibleAnchor([c(1), c(2)], 2)).toEqual({ id: 2, exact: true });
  });

  it("finds a direct reply exactly", () => {
    expect(visibleAnchor([c(1, [c(11), c(12)])], 12)).toEqual({ id: 12, exact: true });
  });

  it("answers a grandchild with its drawable parent, inexact", () => {
    expect(visibleAnchor([c(1, [c(11, [c(111)])])], 111)).toEqual({
      id: 11,
      exact: false,
    });
  });

  it("climbs a deep chain to the depth-1 ancestor", () => {
    let node: unknown = c(9000);
    for (let i = 0; i < 48; i++) node = c(9000 - i - 1, [node]);
    // node is now the top; its single child chain runs 48 deep.
    const top = node as { id: number; childComments: unknown };
    const kid = (top.childComments as unknown[])[0] as { id: number };
    expect(visibleAnchor([top], 9000)).toEqual({ id: kid.id, exact: false });
  });

  it("answers null when the id is nowhere", () => {
    expect(visibleAnchor([c(1, [c(11)])], 999)).toBeNull();
    expect(visibleAnchor("not rows", 1)).toBeNull();
    expect(visibleAnchor([], 1)).toBeNull();
  });

  it("falls back to the root when a malformed child hides the target", () => {
    const malformed = { comment: "no id", childComments: [c(77)] };
    expect(visibleAnchor([c(1, [malformed])], 77)).toEqual({ id: 1, exact: false });
  });
});
