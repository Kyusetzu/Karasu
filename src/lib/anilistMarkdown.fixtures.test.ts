import { describe, expect, it } from "vitest";
import { parseAniListMarkdown, type MdInline, type MdNode } from "./anilistMarkdown";
import fixtures from "./fixtures/anilistMarkdown.fixtures.json";

/** Parity with anilist.co's `asHtml` form by counting what a reader notices, never by matching markup. */

interface Sample {
  kind: "about" | "comment" | "text";
  id: number;
  note: string;
  /** Spoilers and images are graded everywhere, headings and links only where the sampler says the API can be trusted. */
  compare?: (keyof Tally)[];
  raw: string;
  html: string;
}

// A plain JSON import, so the file is typed from its own shape and needs no Node API the tsconfig lacks.
const { samples } = fixtures as { samples: Sample[] };

interface Tally {
  spoilers: number;
  images: number;
  links: number;
  headings: number;
}

function ours(nodes: MdNode[]): Tally {
  const t: Tally = { spoilers: 0, images: 0, links: 0, headings: 0 };
  const inline = (list: MdInline[]): void => {
    for (const n of list) {
      switch (n.type) {
        case "spoiler":
          t.spoilers += 1;
          inline(n.children);
          break;
        case "chip":
          if (n.kind === "image") t.images += 1;
          break;
        case "link":
          t.links += 1;
          inline(n.children);
          break;
        // The site links a mention to the profile; so does `Markdown.tsx`.
        case "mention":
          t.links += 1;
          break;
        case "strong":
        case "em":
        case "strike":
        case "accent":
        case "centered":
          inline(n.children);
          break;
        default:
          break;
      }
    }
  };
  const block = (list: MdNode[]): void => {
    for (const n of list) {
      switch (n.type) {
        case "p":
        case "quote":
          inline(n.children);
          break;
        case "h":
          t.headings += 1;
          inline(n.children);
          break;
        case "list":
          for (const item of n.items) inline(item);
          break;
        case "center":
          block(n.children);
          break;
        case "spoiler":
          t.spoilers += 1;
          block(n.children);
          break;
        default:
          break;
      }
    }
  };
  block(nodes);
  return t;
}

function theirs(html: string): Tally {
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  return {
    spoilers: count(/<span class='markdown_spoiler'>/g),
    images: count(/<img\b/g),
    // A bare `<a>` — profile art — has no href and is a link on neither side.
    links: count(/<a\b[^>]*\bhref=/g),
    headings: count(/<h[1-6]\b/g),
  };
}

describe("parity with anilist.co's own HTML", () => {
  it("samples every field the app renders", () => {
    expect(new Set(samples.map((s) => s.kind))).toEqual(new Set(["about", "comment", "text"]));
    expect(samples.length).toBeGreaterThanOrEqual(5);
  });

  for (const s of samples) {
    const keys = s.compare ?? (["spoilers", "images", "links", "headings"] as const);
    it(`${s.kind} ${s.id} agrees on ${keys.join(", ")} — ${s.note}`, () => {
      const { nodes, truncated } = parseAniListMarkdown(s.raw);
      expect(truncated).toBe(false);
      const pick = (t: Tally) => Object.fromEntries(keys.map((k) => [k, t[k]]));
      expect(pick(ours(nodes))).toEqual(pick(theirs(s.html)));
    });
  }
});
