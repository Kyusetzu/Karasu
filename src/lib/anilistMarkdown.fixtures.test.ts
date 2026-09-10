import { describe, expect, it } from "vitest";
import { parseAniListMarkdown, type MdInline, type MdNode } from "./anilistMarkdown";
import fixtures from "./fixtures/anilistMarkdown.fixtures.json";

/**
 * Structural parity with anilist.co's own rendering.
 *
 * `scripts/sample-markdown.mjs` fetches every sample twice — the raw markdown
 * and its `(asHtml: true)` form, the HTML the website puts on screen — and
 * this compares the two by *counting* what a reader would notice: the
 * spoilers hidden, the images shown, the links offered, the headings set.
 * Never by matching markup. AniList's HTML is not a target to reproduce (its
 * `<h1><center>…</center> ~~~<span …>` for a centred heading is not even
 * well-formed); it is evidence of how many things the site hides, shows and
 * links, and that number is what a user compares Karasu against.
 *
 * A mismatch here is a finding, not a failure to paper over: the first run
 * found an ICO favicon the proxy refused, `&plus;` left undecoded and a
 * centred `- ✧ -` read as a list. Resample with the script when AniList's
 * rendering is suspected of having moved; the ids are documented there.
 */

interface Sample {
  kind: "about" | "comment" | "text";
  id: number;
  note: string;
  /** The counts graded against `asHtml`; absent means all four. The sampler
   *  documents why a sample narrows it. */
  compare?: (keyof Tally)[];
  raw: string;
  html: string;
}

// A plain JSON import (`resolveJsonModule`), so the file is typed from its
// own shape and the test needs no Node API the app's tsconfig does not know.
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
