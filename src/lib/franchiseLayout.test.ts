import { describe, expect, it } from "vitest";
import type { FranchiseEdge, FranchiseNode } from "@/api/franchise";
import { layoutFranchise, PAD, ROW_STEP } from "./franchiseLayout";

const node = (id: number): FranchiseNode => ({
  id,
  type: "ANIME",
  title: { romaji: `T${id}`, english: null, native: null },
  coverImage: { large: null },
  format: null,
  listStatus: null,
  progress: null,
  total: null,
});

const edge = (from: number, to: number, relation = "SEQUEL"): FranchiseEdge => ({
  from,
  to,
  relation,
});

/** 1 → 2 → 5 and 1 → 3 → 6 and 1 → 4: three columns, three rows at depth 1. */
const fan = () => ({
  nodes: [1, 2, 3, 4, 5, 6].map(node),
  edges: [edge(1, 2), edge(1, 3), edge(1, 4), edge(2, 5), edge(3, 6)],
});

describe("layoutFranchise", () => {
  it("parents a chain from the root and derives depth from the parent", () => {
    const { tree } = layoutFranchise(
      [node(1), node(2), node(3)],
      [edge(1, 2), edge(2, 3)],
      1,
    );
    expect(tree.get(1)!.parent).toBe(null);
    expect(tree.get(2)!.parent).toBe(1);
    expect(tree.get(3)!.parent).toBe(2);
    expect([1, 2, 3].map((id) => tree.get(id)!.depth)).toEqual([0, 1, 2]);
  });

  it("records the relation each node was reached through", () => {
    const { tree } = layoutFranchise(
      [node(1), node(2)],
      [edge(1, 2, "SIDE_STORY")],
      1,
    );
    expect(tree.get(2)!.relation).toBe("SIDE_STORY");
    expect(tree.get(1)!.relation).toBe(null);
  });

  it("terminates on cycles and parents each node once", () => {
    const { tree } = layoutFranchise(
      [node(1), node(2), node(3)],
      [edge(1, 2), edge(2, 3), edge(3, 1)],
      1,
    );
    // 3 is reached straight from 1 over the undirected 3–1 edge, so it is a
    // child of the root rather than of 2 — and it is not parented twice.
    expect(tree.get(3)!.parent).toBe(1);
    expect(tree.get(1)!.children).toEqual([2, 3]);
    expect(tree.get(2)!.children).toEqual([]);
  });

  it("makes a node unreachable from the root a root of its own", () => {
    const { tree, positions, visible } = layoutFranchise(
      [node(1), node(99)],
      [],
      1,
    );
    expect(tree.get(99)!.parent).toBe(null);
    expect(tree.get(99)!.depth).toBe(0);
    expect(positions.has(99)).toBe(true);
    expect(visible.has(99)).toBe(true);
  });

  it("counts the whole subtree beneath a node, not just its children", () => {
    const { tree } = fanLayout();
    expect(tree.get(1)!.descendants).toBe(5);
    expect(tree.get(2)!.descendants).toBe(1);
    expect(tree.get(5)!.descendants).toBe(0);
  });

  it("places depth in columns and keeps a subtree contiguous", () => {
    const { positions } = fanLayout();
    expect(positions.get(1)!.x).toBeLessThan(positions.get(2)!.x);
    expect(positions.get(2)!.x).toBeLessThan(positions.get(5)!.x);
    // 2, 3 and 4 share a column…
    const col = [2, 3, 4].map((id) => positions.get(id)!.x);
    expect(new Set(col).size).toBe(1);
    // …in pre-order, so each branch stays in one block.
    const rows = [2, 3, 4].map((id) => positions.get(id)!.y);
    expect(rows[0]).toBeLessThan(rows[1]);
    expect(rows[1]).toBeLessThan(rows[2]);
  });

  it("hides a collapsed node's subtree but keeps the node itself", () => {
    const { visible, positions } = fanLayout(new Set([2]));
    expect(visible.has(2)).toBe(true);
    expect(visible.has(5)).toBe(false);
    expect(positions.has(5)).toBe(false);
  });

  it("closes ranks when a branch collapses instead of leaving a hole", () => {
    // Depth 2 holds 5 and 6, so 6 sits in the second row of a column that is
    // centred against the three-row depth-1 column.
    const before = fanLayout().positions.get(6)!.y;
    expect(before).toBe(PAD + (3 * ROW_STEP - 2 * ROW_STEP) / 2 + ROW_STEP);
    // With 5 gone, 6 is the only node left at that depth and re-centres.
    const after = fanLayout(new Set([2])).positions.get(6)!.y;
    expect(after).toBe(PAD + (3 * ROW_STEP - ROW_STEP) / 2);
    expect(after).toBeLessThan(before);
  });

  it("narrows the canvas when the deepest column collapses away", () => {
    const full = fanLayout();
    const trimmed = fanLayout(new Set([2, 3]));
    expect(trimmed.width).toBeLessThan(full.width);
  });
});

function fanLayout(collapsed?: ReadonlySet<number>) {
  const { nodes, edges } = fan();
  return layoutFranchise(nodes, edges, 1, collapsed);
}
