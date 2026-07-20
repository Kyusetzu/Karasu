import { describe, expect, it } from "vitest";
import type { FranchiseEdge, FranchiseNode } from "@/api/franchise";
import { layoutFranchise } from "./franchiseLayout";

const node = (id: number): FranchiseNode => ({
  id,
  type: "ANIME",
  title: { romaji: `T${id}`, english: null, native: null },
  coverImage: { large: null },
  format: null,
  listStatus: null,
});

const edge = (from: number, to: number): FranchiseEdge => ({
  from,
  to,
  relation: "SEQUEL",
});

describe("layoutFranchise", () => {
  it("layers a chain by BFS distance from the root", () => {
    const { layers } = layoutFranchise(
      [node(1), node(2), node(3)],
      [edge(1, 2), edge(2, 3)],
      1,
    );
    expect(layers.get(1)).toBe(0);
    expect(layers.get(2)).toBe(1);
    expect(layers.get(3)).toBe(2);
  });

  it("terminates on cycles and layers each node once", () => {
    const { layers } = layoutFranchise(
      [node(1), node(2), node(3)],
      [edge(1, 2), edge(2, 3), edge(3, 1)],
      1,
    );
    expect(layers.get(1)).toBe(0);
    expect(layers.get(2)).toBe(1);
    // 3 is reached from 1 directly (via the 3->1 edge, undirected) => layer 1.
    expect(layers.get(3)).toBe(1);
  });

  it("puts nodes unreachable from the root in column 0", () => {
    const { layers, positions } = layoutFranchise(
      [node(1), node(99)],
      [],
      1,
    );
    expect(layers.get(99)).toBe(0);
    expect(positions.has(99)).toBe(true);
  });

  it("positions the root in the first column", () => {
    const { positions } = layoutFranchise([node(1), node(2)], [edge(1, 2)], 1);
    const root = positions.get(1)!;
    const child = positions.get(2)!;
    expect(child.x).toBeGreaterThan(root.x);
  });
});
