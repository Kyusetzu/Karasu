import type { FranchiseEdge, FranchiseNode } from "@/api/franchise";

/** Node box and grid pitch for the franchise canvas in em, so a text-scale bump grows the whole graph coherently. */
export const NODE_W = 5.25;
/** 2:3 cover + the two label lines beneath it. */
export const COVER_H = NODE_W * 1.5;
export const NODE_H = COVER_H + 2.5;
export const COL_STEP = 11.5;
export const ROW_STEP = 11;
export const PAD = 4;

export interface FranchiseTreeNode {
  id: number;
  /** null for the root and for anything unreachable from it. */
  parent: number | null;
  depth: number;
  children: number[];
  /** Relation carried by the edge this node was first reached through. */
  relation: string | null;
}

export interface FranchiseLayout {
  /** Top-left of each visible node's box, keyed by media id. */
  positions: Map<number, { x: number; y: number }>;
  tree: Map<number, FranchiseTreeNode>;
  width: number;
  height: number;
}

/** Lays the franchise out as a BFS tree rooted at `rootId`, one centred column per depth; unreachable nodes become roots. */
export function layoutFranchise(
  nodes: FranchiseNode[],
  edges: FranchiseEdge[],
  rootId: number,
): FranchiseLayout {
  const adj = new Map<number, { to: number; relation: string }[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.from)?.push({ to: e.to, relation: e.relation });
    adj.get(e.to)?.push({ to: e.from, relation: e.relation });
  }

  const tree = new Map<number, FranchiseTreeNode>();
  const roots: number[] = [];

  const walk = (start: number) => {
    if (tree.has(start)) return;
    tree.set(start, {
      id: start,
      parent: null,
      depth: 0,
      children: [],
      relation: null,
    });
    roots.push(start);
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      const node = tree.get(cur)!;
      for (const { to, relation } of adj.get(cur) ?? []) {
        if (tree.has(to)) continue;
        tree.set(to, {
          id: to,
          parent: cur,
          depth: node.depth + 1,
          children: [],
          relation,
        });
        node.children.push(to);
        queue.push(to);
      }
    }
  };

  // The root first so it owns depth 0, then anything the walk never reached, because hiding it would misreport the graph.
  if (nodes.some((n) => n.id === rootId)) walk(rootId);
  for (const n of nodes) walk(n.id);

  // Pre-order keeps a subtree contiguous within its column, so a branch reads as one block.
  const order: number[] = [];
  const descend = (id: number) => {
    order.push(id);
    for (const child of tree.get(id)!.children) descend(child);
  };
  for (const id of roots) descend(id);

  const cols = new Map<number, number[]>();
  for (const id of order) {
    const { depth } = tree.get(id)!;
    if (!cols.has(depth)) cols.set(depth, []);
    cols.get(depth)!.push(id);
  }

  const maxDepth = Math.max(...cols.keys(), 0);
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length), 1);
  const contentH = maxRows * ROW_STEP;

  const positions = new Map<number, { x: number; y: number }>();
  for (const [depth, list] of cols) {
    const startY = (contentH - list.length * ROW_STEP) / 2;
    list.forEach((id, i) => {
      positions.set(id, {
        x: PAD + depth * COL_STEP,
        y: PAD + startY + i * ROW_STEP,
      });
    });
  }

  return {
    positions,
    tree,
    width: maxDepth * COL_STEP + NODE_W + PAD * 2,
    height: contentH + PAD * 2,
  };
}
