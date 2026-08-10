import { describe, expect, it } from "vitest";
import {
  parseAniListMarkdown,
  renderPlain,
  type MdInline,
  type MdNode,
} from "./anilistMarkdown";

/** Every node type the renderer knows how to draw. Hardcoded on purpose: adding
 *  a member to the union without adding it here fails the walk below, which is
 *  the pressure we want — a new node type must be reviewed, not absorbed. */
const BLOCK_TYPES = new Set(["p", "h", "quote", "list", "codeBlock", "hr", "center"]);
const INLINE_TYPES = new Set([
  "text", "strong", "em", "strike", "code", "link", "mention", "spoiler", "chip", "br",
]);

/** Fields a node is allowed to carry. Anything else could be unrendered markup
 *  smuggled through as data. */
const ALLOWED_FIELDS = new Set([
  "type", "text", "children", "level", "items", "ordered", "href", "name", "kind", "host",
]);

function walk(
  nodes: (MdNode | MdInline)[],
  visit: (n: MdNode | MdInline) => void,
): void {
  for (const n of nodes) {
    visit(n);
    if ("children" in n && Array.isArray(n.children)) walk(n.children, visit);
    if (n.type === "list") for (const item of n.items) walk(item, visit);
  }
}

function parse(src: string) {
  return parseAniListMarkdown(src).nodes;
}

/** Concatenated text of a tree, for asserting "the tag went, the words stayed". */
function textOf(nodes: (MdNode | MdInline)[]): string {
  let s = "";
  walk(nodes, (n) => {
    if (n.type === "text" || n.type === "code" || n.type === "codeBlock") s += n.text;
  });
  return s;
}

function types(nodes: (MdNode | MdInline)[]): string[] {
  const out: string[] = [];
  walk(nodes, (n) => out.push(n.type));
  return out;
}

// --- The security boundary -------------------------------------------------

describe("the tree cannot carry executable content", () => {
  // Deliberately nasty, and drawn from what real bios contain: raw tags, event
  // handlers, and AniList's own layout blob.
  const HOSTILE = [
    `<script>alert(1)</script>`,
    `<b onmouseover=alert(1)>hi</b>`,
    `<img src=x onerror=alert(1)>`,
    `<div style="background:url(//evil)">art</div>`,
    `<!-- comment --><!DOCTYPE html>`,
    `<iframe src="javascript:alert(1)"></iframe>`,
    `[click](javascript:alert(1))`,
    `[click](JaVaScRiPt:alert(1))`,
    `[click](data:text/html;base64,PHNjcmlwdD4=)`,
    `[click](vbscript:msgbox)`,
    `[](jsonN4IgDglgdlCmAmIBcAWA7ADgMwFY0EYMAmAXyA==)`,
    `img(javascript:alert(1))`,
    `img(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)`,
    `<a href="javascript:alert(1)">x</a>`,
    `~!<script>alert(1)</script>!~`,
    `**<script>alert(1)</script>**`,
    `<div\nunclosed`,
    `<sVg/onload=alert(1)>`,
  ];

  it("emits no node type outside the union, on hostile input", () => {
    for (const src of HOSTILE) {
      walk(parse(src), (n) => {
        const known = BLOCK_TYPES.has(n.type) || INLINE_TYPES.has(n.type);
        expect(known, `unknown node type ${n.type} from ${src}`).toBe(true);
      });
    }
  });

  it("emits no field outside the allowed set", () => {
    for (const src of HOSTILE) {
      walk(parse(src), (n) => {
        for (const key of Object.keys(n)) {
          expect(ALLOWED_FIELDS.has(key), `unexpected field "${key}" from ${src}`).toBe(true);
        }
      });
    }
  });

  it("every link href is http, https or an internal path — never a scheme URL", () => {
    for (const src of HOSTILE) {
      walk(parse(src), (n) => {
        if (n.type === "link" || n.type === "chip") {
          expect(
            /^https?:\/\//i.test(n.href) || n.href.startsWith("/"),
            `dangerous href ${n.href} from ${src}`,
          ).toBe(true);
        }
      });
    }
  });

  it("produces no link or chip at all for a dangerous URL", () => {
    for (const src of HOSTILE) {
      const kinds = types(parse(src));
      if (/javascript:|data:|vbscript:|json[A-Z]/i.test(src)) {
        expect(kinds).not.toContain("link");
        expect(kinds).not.toContain("chip");
      }
    }
  });

  it("keeps no angle bracket from a tag anywhere in the text", () => {
    for (const src of HOSTILE) {
      const text = textOf(parse(src));
      expect(text).not.toMatch(/<[a-zA-Z/!]/);
    }
  });
});

// --- HTML degrades to prose ------------------------------------------------

describe("raw HTML drops the tag and keeps the words", () => {
  it("keeps the text inside a tag with a handler", () => {
    expect(textOf(parse(`<b onmouseover=alert(1)>hi</b>`))).toBe("hi");
  });

  it("drops a script or style body entirely, contents included", () => {
    // Not merely inert — gone. Every other element's text is prose worth
    // keeping; theirs is code nobody meant to read, and rendering it produced
    // `bold bitalert(1)` on a real HTML-art bio.
    expect(textOf(parse(`<script>alert(1)</script>`))).toBe("");
    expect(textOf(parse(`<style>body{color:red}</style>`))).toBe("");
    expect(textOf(parse(`before<script>alert(1)</script>after`))).toBe("beforeafter");
    // An unclosed one takes the rest with it, rather than leaking the tail.
    expect(textOf(parse(`kept<script>alert(1)`))).toBe("kept");
    expect(types(parse(`<script>alert(1)</script>`))).not.toContain("link");
  });

  it("drops comments and doctypes entirely", () => {
    expect(textOf(parse(`<!-- hidden -->kept`))).toBe("kept");
    expect(textOf(parse(`<!DOCTYPE html>kept`))).toBe("kept");
  });

  it("drops an unclosed tag at the end instead of showing the fragment", () => {
    expect(textOf(parse(`text <div`))).toBe("text ");
  });

  it("yields nothing at all for a void tag with no text", () => {
    expect(textOf(parse(`<img src=x onerror=alert(1)>`))).toBe("");
  });

  it("turns an HTML-art bio into its prose", () => {
    const art = `<div style="position:absolute;background:url(//x)"><span>tam</span></div>`;
    expect(textOf(parse(art))).toBe("tam");
  });

  it("treats <br> as a line break", () => {
    expect(types(parse(`a<br>b`))).toContain("br");
    expect(types(parse(`a<br />b`))).toContain("br");
  });
});

// --- Inline forms ---------------------------------------------------------

describe("inline forms", () => {
  const first = (src: string) => (parse(src)[0] as { children: MdInline[] }).children;

  it("parses both bold spellings", () => {
    expect(first(`**b**`)[0].type).toBe("strong");
    expect(first(`__b__`)[0].type).toBe("strong");
  });

  it("parses both italic spellings", () => {
    expect(first(`*i*`)[0].type).toBe("em");
    expect(first(`_i_`)[0].type).toBe("em");
  });

  it("nests emphasis when the delimiters differ", () => {
    const n = first(`**bold _and italic_**`)[0];
    expect(n.type).toBe("strong");
    expect(types([n])).toContain("em");
  });

  it("does not nest a same-character triple — a known, bounded limitation", () => {
    // `**bold *and italic***` needs CommonMark's delimiter-run algorithm to
    // decide that the third closing `*` belongs to the inner emphasis. This
    // parser matches greedily instead, so the outer strong wins and the inner
    // `*` is left as text. Recorded as a test rather than left to be
    // rediscovered: the whole run still renders, just bold rather than
    // bold-italic, and no content is lost.
    const n = first(`**bold *and italic***`)[0];
    expect(n.type).toBe("strong");
    expect(types([n])).not.toContain("em");
    expect(textOf([n])).toContain("and italic");
  });

  it("parses strikethrough without eating a centre fence", () => {
    expect(first(`~~gone~~`)[0].type).toBe("strike");
    // Three tildes is a centre block, not strike-plus-tilde.
    expect(parse(`~~~mid~~~`)[0].type).toBe("center");
  });

  it("follows CommonMark's asymmetry: `*` emphasises intraword, `_` does not", () => {
    // Not a preference — markdown-it is what AniList runs, and it follows
    // CommonMark, where `a*b*c` is `a<em>b</em>c` and `a_b_c` is literal.
    // Matching the real dialect matters more than matching intuition, and the
    // `_` half is load-bearing: underscores are ordinary inside usernames, file
    // names and URLs, so without it `snake_case_name` renders half italic.
    expect(types(parse(`a*b*c`))).toContain("em");
    expect(types(parse(`a_b_c`))).not.toContain("em");
    expect(textOf(parse(`a_b_c`))).toBe("a_b_c");
    expect(types(parse(`snake_case_name`))).not.toContain("em");
    expect(textOf(parse(`snake_case_name`))).toBe("snake_case_name");
    expect(types(parse(`file__name__here`))).not.toContain("strong");
  });

  it("leaves an unmatched asterisk as text", () => {
    expect(types(parse(`2 * 3`))).not.toContain("em");
    expect(textOf(parse(`5 * 4 = 20`))).toBe("5 * 4 = 20");
  });

  it("does not open emphasis on a following space", () => {
    expect(types(parse(`a ** b`))).not.toContain("strong");
  });

  it("parses inline code and leaves its content unparsed", () => {
    const n = first("`**not bold**`")[0];
    expect(n.type).toBe("code");
    expect(n).toMatchObject({ text: "**not bold**" });
  });

  it("parses a link and keeps its label as children", () => {
    const n = first(`[label](https://anilist.co)`)[0];
    expect(n).toMatchObject({ type: "link", href: "https://anilist.co" });
    expect(textOf([n])).toBe("label");
  });

  it("autolinks a bare URL", () => {
    const n = first(`see https://anilist.co now`)[1];
    expect(n).toMatchObject({ type: "link", href: "https://anilist.co" });
  });

  it("parses a mention but not an email address", () => {
    expect(first(`hi @kyu`)[1]).toMatchObject({ type: "mention", name: "kyu" });
    expect(types(parse(`mail foo@bar.com`))).not.toContain("mention");
  });

  it("parses a spoiler with parsed children, and degrades an unclosed one", () => {
    const n = first(`~!**hidden**!~`)[0];
    expect(n.type).toBe("spoiler");
    expect(types([n])).toContain("strong");
    expect(types(parse(`~!never closed`))).not.toContain("spoiler");
    expect(textOf(parse(`~!never closed`))).toBe("~!never closed");
  });
});

// --- AniList's own image and embed forms ----------------------------------

describe("images and embeds become chips, never pictures", () => {
  const chips = (src: string) => {
    const out: MdInline[] = [];
    walk(parse(src), (n) => {
      if (n.type === "chip") out.push(n);
    });
    return out as Extract<MdInline, { type: "chip" }>[];
  };

  it("handles every AniList image size form found in real bios", () => {
    for (const src of [
      `img(https://i.imgur.com/a.png)`,
      `img28(https://i.imgur.com/a.png)`,
      `img120(https://i.imgur.com/a.png)`,
      `img200%(https://i.imgur.com/a.png)`,
    ]) {
      const c = chips(src);
      expect(c, src).toHaveLength(1);
      expect(c[0].kind).toBe("image");
      expect(c[0].host).toBe("i.imgur.com");
    }
  });

  it("handles markdown's image form too, rare as it is", () => {
    expect(chips(`![alt](https://i.imgur.com/a.png)`)).toHaveLength(1);
  });

  it("makes youtube and webm video chips", () => {
    expect(chips(`youtube(https://youtu.be/abc)`)[0].kind).toBe("video");
    expect(chips(`webm(https://x.co/a.webm)`)[0].kind).toBe("video");
  });

  it("emits no img element anywhere — the whole point", () => {
    expect(types(parse(`img(https://i.imgur.com/a.png)`))).not.toContain("image");
    expect(types(parse(`img(https://i.imgur.com/a.png)`))).toContain("chip");
  });

  it("handles an image nested inside a link, as real bios write it", () => {
    // `[img33(url) ](target)` — a linked image. Both survive, in that order.
    const nodes = parse(`[img33(https://i.imgur.com/a.png) ](https://myanimelist.net/x)`);
    const kinds = types(nodes);
    expect(kinds).toContain("link");
    expect(kinds).toContain("chip");
  });
});

// --- Block structure ------------------------------------------------------

describe("block structure", () => {
  it("makes a single newline a break and a blank line a new paragraph", () => {
    // The bio-shape assertion: 36 of 44 sampled bios are line-oriented, and
    // collapsing newlines would render every one of them as a single blob.
    const one = parse(`line one\nline two`);
    expect(one).toHaveLength(1);
    expect(types(one)).toContain("br");

    const two = parse(`para one\n\npara two`);
    expect(two).toHaveLength(2);
    expect(two.every((n) => n.type === "p")).toBe(true);
    expect(types(two)).not.toContain("br");
  });

  it("parses all six heading levels and no seventh", () => {
    for (let l = 1; l <= 6; l++) {
      const n = parse(`${"#".repeat(l)} title`)[0];
      expect(n).toMatchObject({ type: "h", level: l });
    }
    expect(parse(`####### too many`)[0].type).toBe("p");
  });

  it("does not treat a hashtag as a heading", () => {
    expect(parse(`#nothashtag`)[0].type).toBe("p");
  });

  it("merges consecutive quote lines into one block", () => {
    const nodes = parse(`> one\n> two\n\nafter`);
    expect(nodes.filter((n) => n.type === "quote")).toHaveLength(1);
    expect(nodes).toHaveLength(2);
  });

  it("parses horizontal rules in all three spellings", () => {
    for (const src of [`---`, `***`, `___`]) {
      expect(parse(src)[0], src).toMatchObject({ type: "hr" });
    }
  });

  it("parses one-level lists and flattens a nested item", () => {
    const ul = parse(`- a\n- b`)[0] as Extract<MdNode, { type: "list" }>;
    expect(ul).toMatchObject({ type: "list", ordered: false });
    expect(ul.items).toHaveLength(2);

    const ol = parse(`1. a\n2. b`)[0] as Extract<MdNode, { type: "list" }>;
    expect(ol).toMatchObject({ type: "list", ordered: true });

    const nested = parse(`- a\n  - deep\n- b`)[0] as Extract<MdNode, { type: "list" }>;
    expect(nested.items).toHaveLength(3); // flat, not a sub-list
  });

  it("keeps a fenced block's content completely unparsed", () => {
    const n = parse("```\n~!not a spoiler!~ **not bold**\n```")[0];
    expect(n).toMatchObject({
      type: "codeBlock",
      text: "~!not a spoiler!~ **not bold**",
    });
    expect(types([n])).not.toContain("spoiler");
  });

  it("parses a centre block in all three spellings, with content inside", () => {
    const bare = parse(`~~~\ncentred **text**\n~~~`)[0];
    expect(bare.type).toBe("center");
    expect(types([bare])).toContain("strong");

    const oneLine = parse(`~~~img28(https://i.imgur.com/a.png)~~~`)[0];
    expect(oneLine.type).toBe("center");
    expect(types([oneLine])).toContain("chip");

    // Content on the opening fence's own line. This is the form that shipped a
    // literal `~~~` to screen — a real bio opens with `~~~ tam | she/her | arg`
    // and the old rule demanded a bare `~~~` line.
    const trailing = parse(`~~~ tam | she/her\n\n[insta](https://instagram.com/x)\n\n~~~`);
    expect(trailing[0].type).toBe("center");
    expect(textOf(trailing)).toContain("she/her");
    expect(textOf(trailing)).not.toContain("~~~");
    expect(types(trailing)).toContain("link");
  });

  it("leaves no fence marker in the rendered text, in any spelling", () => {
    for (const src of [
      `~~~ trailing content\nmore\n~~~`,
      `~~~\nbare\n~~~`,
      `~~~one line~~~`,
      `~~~ unclosed content`,
    ]) {
      expect(textOf(parse(src)), src).not.toContain("~~~");
    }
  });

  it("renders table rows as cell text rather than dropping them", () => {
    const nodes = parse(`| a | b |\n| --- | --- |\n| c | d |`);
    const text = textOf(nodes);
    expect(text).toContain("a");
    expect(text).toContain("d");
    expect(types(nodes)).not.toContain("table");
  });
});

// --- Truncation and termination -------------------------------------------

describe("bounds", () => {
  it("truncates past the limit and says so", () => {
    const long = "a".repeat(9000);
    const r = parseAniListMarkdown(long);
    expect(r.truncated).toBe(true);
    expect(textOf(r.nodes).length).toBeLessThanOrEqual(8000);

    const short = parseAniListMarkdown("a".repeat(10));
    expect(short.truncated).toBe(false);
  });

  it("never leaves an unclosed element when truncation splits a delimiter", () => {
    // Nodes are only created on a complete match, so a split delimiter can only
    // ever degrade to text. Asserted rather than trusted.
    const r = parseAniListMarkdown(`${"x".repeat(7998)}**bold**`, { limit: 8000 });
    expect(r.truncated).toBe(true);
    walk(r.nodes, (n) => {
      expect(BLOCK_TYPES.has(n.type) || INLINE_TYPES.has(n.type)).toBe(true);
    });
  });

  it("does not let a nested match rewind the outer scan", () => {
    // The bug this pins, because it was real and it was not obvious: the
    // patterns are module-level objects and `parseInline` recurses into its own
    // matches, so an inner call mutated the `lastIndex` the outer loop was
    // about to advance by — and a failed sticky `exec` resets it to 0. `~!~!~!`
    // was enough: the index went backwards and the loop allocated until the
    // heap died. Every branch now advances by the match's own length.
    //
    // Short, self-terminating inputs, so a regression is a hang rather than a
    // slow test — which is why the timing assertion below exists as well.
    for (const src of ["~!~!~!", "~!~!~!~!~!~!", "**a**b**c**", "*a*b*c*", "[a](b)[c](d)"]) {
      const r = parseAniListMarkdown(src);
      expect(Array.isArray(r.nodes), src).toBe(true);
      // A rewind produced tens of thousands of nodes for a six-character input.
      const count: string[] = [];
      walk(r.nodes, (n) => count.push(n.type));
      expect(count.length, src).toBeLessThan(60);
    }
  });

  it("terminates on pathological input", () => {
    const started = Date.now();
    for (const src of [
      "*".repeat(5000),
      "[".repeat(2000),
      "~!".repeat(1000),
      "~".repeat(4000),
      "`".repeat(3000),
      "<".repeat(3000),
      "<div ".repeat(1000),
      "x".repeat(200_000),
      `${"**".repeat(2000)}end`,
      "|".repeat(2000),
      "#".repeat(1000),
      "> ".repeat(2000),
    ]) {
      expect(() => parseAniListMarkdown(src)).not.toThrow();
    }
    // Generous, but it fails loudly if the scan ever goes quadratic again.
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("handles a real bio's shape without throwing", () => {
    // Trimmed from a live profile: nested centre blocks, sized images, links.
    const real =
      `~~~img28(https://gifcity.carrd.co/a.gif) img(https://gifcity.carrd.co/b.gif)~~~\n\n` +
      `~~~ tam | she/her | arg\n\n[instagram ](https://www.instagram.com/x/) + ` +
      `[spotify](https://open.spotify.com/user/y?si=z&utm_source=copy-link)\n\n~~~`;
    const r = parseAniListMarkdown(real);
    expect(r.truncated).toBe(false);
    expect(types(r.nodes)).toContain("center");
    expect(types(r.nodes)).toContain("chip");
    expect(textOf(r.nodes)).toContain("she/her");
  });

  it("survives input that is not a string", () => {
    for (const bad of [undefined, null, 42, {}, []] as unknown[]) {
      expect(() => parseAniListMarkdown(bad as string)).not.toThrow();
    }
  });

  it("returns nothing for empty input", () => {
    expect(parseAniListMarkdown("").nodes).toEqual([]);
    expect(parseAniListMarkdown("   \n\n  ").nodes).toEqual([]);
  });
});

// --- renderPlain ----------------------------------------------------------

describe("renderPlain", () => {
  it("strips every form down to words", () => {
    expect(renderPlain(`**bold** and *italic* and ~~gone~~`)).toBe(
      "bold and italic and gone",
    );
    expect(renderPlain(`# Heading\n\ntext`)).toBe("Heading text");
  });

  it("drops chips but keeps a link's label and a mention's name", () => {
    expect(renderPlain(`img(https://i.imgur.com/a.png)hello`)).toBe("hello");
    expect(renderPlain(`[label](https://anilist.co)`)).toBe("label");
    expect(renderPlain(`hi @kyu`)).toBe("hi @kyu");
  });

  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(renderPlain(`a\n\n\nb`)).toBe("a b");
    const out = renderPlain("word ".repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("reveals no spoiler text unintentionally — it flattens like everything else", () => {
    // Documenting the behaviour rather than asserting a security property: a
    // preview is not a place to put a spoiler, so callers must not use this for
    // one. The renderer, not this, is what hides them.
    expect(renderPlain(`~!secret!~`)).toBe("secret");
  });
});
