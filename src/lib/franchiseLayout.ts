import type { FranchiseEdge, FranchiseNode } from "@/api/franchise";

// Node box + grid spacing for the franchise SVG.
export const NODE_W = 168;
export const NODE_H = 62;
export const COL_STEP = 244;
export const ROW_STEP = 86;
export const PAD = 28;

export interface FranchiseLayout {
  /** Top-left position of each node's box, keyed by media id. */
  positions: Map<number, { x: number; y: number }>;
  /** BFS distance of each node from the root (its column). */
  layers: Map<number, number>;
  width: number;
  height: number;
}

/**
 * Lay the franchise out in columns by BFS distance from the root over the
 * undirected relation graph. Pure (no DOM) so it can be unit-tested; cycles
 * terminate (each node is layered once) and nodes unreachable from the root
 * fall into column 0.
 */
export function layoutFranchise(
  nodes: FranchiseNode[],
  edges: FranchiseEdge[],
  rootId: number,
): FranchiseLayout {
  const adj = new Map<number, number[]>();
  nodes.forEach((n) => adj.set(n.id, []));
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
    adj.get(e.to)?.push(e.from);
  }

  const layers = new Map<number, number>();
  const queue: number[] = [];
  if (nodes.some((n) => n.id === rootId)) {
    layers.set(rootId, 0);
    queue.push(rootId);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const l = layers.get(cur)!;
    for (const nb of adj.get(cur) ?? []) {
      if (!layers.has(nb)) {
        layers.set(nb, l + 1);
        queue.push(nb);
      }
    }
  }
  for (const n of nodes) if (!layers.has(n.id)) layers.set(n.id, 0);

  const cols = new Map<number, FranchiseNode[]>();
  for (const n of nodes) {
    const l = layers.get(n.id)!;
    if (!cols.has(l)) cols.set(l, []);
    cols.get(l)!.push(n);
  }

  const maxLayer = Math.max(...[...cols.keys()], 0);
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length), 1);
  const contentH = maxRows * ROW_STEP;

  const positions = new Map<number, { x: number; y: number }>();
  for (const [l, list] of cols) {
    const startY = (contentH - list.length * ROW_STEP) / 2;
    list.forEach((n, i) => {
      positions.set(n.id, {
        x: PAD + l * COL_STEP,
        y: PAD + startY + i * ROW_STEP,
      });
    });
  }

  return {
    positions,
    layers,
    width: maxLayer * COL_STEP + NODE_W + PAD * 2,
    height: contentH + PAD * 2,
  };
}
