import {
  parseAniListMarkdown,
  type MdInline,
  type MdNode,
} from "@/lib/anilistMarkdown";

/** The tree walkers the AniList-markdown tests share; no assertions live here, only ways of reading a parse. */

/** Every node type the renderer draws, hardcoded so a new union member must be reviewed here, not absorbed. */
export const BLOCK_TYPES = new Set(["p", "h", "quote", "list", "codeBlock", "hr", "center", "spoiler"]);
export const INLINE_TYPES = new Set([
  "text", "strong", "em", "strike", "code", "link", "mention", "spoiler", "chip", "br",
  "accent", "centered",
]);

/** Fields a node is allowed to carry; anything else could be unrendered markup smuggled through as data. */
export const ALLOWED_FIELDS = new Set([
  "type", "text", "children", "level", "items", "ordered", "href", "name", "kind", "host",
  // Plain chip data that cannot carry markup: a clamped number with a closed-union unit, and a boolean.
  "width", "capped",
]);

export function walk(
  nodes: (MdNode | MdInline)[],
  visit: (n: MdNode | MdInline) => void,
): void {
  for (const n of nodes) {
    visit(n);
    if ("children" in n && Array.isArray(n.children)) walk(n.children, visit);
    if (n.type === "list") for (const item of n.items) walk(item, visit);
  }
}

export function parse(src: string) {
  return parseAniListMarkdown(src).nodes;
}

/** Every chip in a document, in order — `walk` already knows the whole union. */
export function chipsOf(src: string) {
  const out: Extract<MdInline, { type: "chip" }>[] = [];
  walk(parse(src), (n) => {
    if (n.type === "chip") out.push(n);
  });
  return out;
}

/** Concatenated text of a tree, for asserting "the tag went, the words stayed". */
export function textOf(nodes: (MdNode | MdInline)[]): string {
  let s = "";
  walk(nodes, (n) => {
    if (n.type === "text" || n.type === "code" || n.type === "codeBlock") s += n.text;
  });
  return s;
}

export function types(nodes: (MdNode | MdInline)[]): string[] {
  const out: string[] = [];
  walk(nodes, (n) => out.push(n.type));
  return out;
}
