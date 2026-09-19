import { describe, expect, it } from "vitest";
import type { MdInline, MdNode } from "./anilistMarkdown";
import {
  MAX_INLINE_IMAGES,
  parseImageWidth,
  renderPlain,
} from "./anilistMarkdown";
import {
  chipsOf,
  parse,
  textOf,
  types,
  walk,
} from "@/test/markdown";

/** The block vocabulary: spoilers, chips, headings and lists, centred rows and what renderPlain keeps. */

describe("block spoilers", () => {
  /** The block-level spoiler nodes of a document, in order. */
  const spoilers = (src: string) =>
    parse(src).filter((n): n is Extract<MdNode, { type: "spoiler" }> => n.type === "spoiler");

  it("hides two paragraphs behind one spoiler", () => {
    // The forum's usual shape: the opener on its own line, blank lines inside.
    const nodes = parse(`~!\nfirst paragraph\n\nsecond paragraph\n!~`);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("spoiler");
    const inner = (nodes[0] as { children: MdNode[] }).children;
    expect(inner.map((n) => n.type)).toEqual(["p", "p"]);
    expect(textOf(inner)).toBe("first paragraphsecond paragraph");
  });

  it("takes a list and an image line with it", () => {
    const [s] = spoilers(`~!what happens:\n- she leaves\n- he stays\nimg(https://i.imgur.com/a.png)!~`);
    expect(s.children.map((n) => n.type)).toEqual(["p", "list", "p"]);
    expect(chipsOf(`~!x\nimg(https://i.imgur.com/a.png)\n!~`)).toHaveLength(1);
  });

  it("keeps the text before the opener and after the closer outside", () => {
    const nodes = parse(`Thoughts: ~!the butler\n\ndid it!~ and that's all`);
    expect(nodes.map((n) => n.type)).toEqual(["p", "spoiler", "p"]);
    // Trailing whitespace goes with the paragraph's own trim; leading stays.
    expect(textOf([nodes[0]])).toBe("Thoughts:");
    expect(textOf([nodes[2]])).toBe(" and that's all");
    expect(textOf((nodes[1] as { children: MdNode[] }).children)).toBe("the butlerdid it");
  });

  it("leaves an opener with no closer anywhere below literal", () => {
    const nodes = parse(`~!never\n\nclosed`);
    expect(types(nodes)).not.toContain("spoiler");
    expect(textOf(nodes)).toBe("~!neverclosed");
  });

  it("opens on a paragraph's later line, not only its first", () => {
    // `before` and `~!` share a paragraph; the spoiler must still be found.
    const nodes = parse(`before\n~!\nsecret\n\nlines\n!~\nafter`);
    expect(nodes.map((n) => n.type)).toEqual(["p", "spoiler", "p"]);
    expect(textOf([nodes[0]])).toBe("before");
    expect(textOf([nodes[2]])).toBe("after");
  });

  it("does not open a block for a spoiler closed on its own line", () => {
    const nodes = parse(`~!inline!~ text\n\nmore`);
    expect(nodes.map((n) => n.type)).toEqual(["p", "p"]);
    expect(types([nodes[0]])).toContain("spoiler");
  });

  it("nests with centring in either order", () => {
    const [s] = spoilers(`~!\n~~~centred~~~\n!~`);
    expect(s.children.map((n) => n.type)).toEqual(["center"]);
    const [c] = parse(`~~~\n~!hidden\n\nlines!~\n~~~`);
    expect(c.type).toBe("center");
    expect((c as { children: MdNode[] }).children.map((n) => n.type)).toEqual(["spoiler"]);
  });

  it("wins over a fence that opens inside it, as anilist.co converts spoilers in code too", () => {
    const [s] = spoilers("~!\n```\ncode\n```\n!~");
    expect(s.children.map((n) => n.type)).toEqual(["codeBlock"]);
    // But a fence that opens first keeps its sample literal.
    expect(types(parse("```\n~!not a spoiler\n\nstill not!~\n```"))).not.toContain("spoiler");
  });

  it("counts the images inside it towards the cap", () => {
    const line = "img(https://i.imgur.com/a.png)";
    const src = `~!\n${Array.from({ length: 26 }, () => line).join("\n\n")}\n!~`;
    expect(chipsOf(src).filter((c) => c.capped)).toHaveLength(2);
  });
});

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

  /** The sized form is what most real bios use, so a non-capturing size group ignores nearly every author's width. */
  it("keeps the width the author asked for", () => {
    const chip = (src: string) => chipsOf(src)[0];

    expect(chip("img33(https://i.imgur.com/a.png)")).toMatchObject({
      href: "https://i.imgur.com/a.png",
      width: { value: 33, unit: "px" },
    });
    expect(chip("img200%(https://i.imgur.com/a.png)")).toMatchObject({
      width: { value: 100, unit: "%" },
    });
    // No declared size carries no width at all, rather than a default.
    expect(chip("img(https://i.imgur.com/a.png)")).not.toHaveProperty("width");
  });

  /** AniList documents the number as pixels; an absurd value is not a layout, so it clamps before the DOM. */
  it("clamps a width that is not a layout", () => {
    expect(parseImageWidth("999999")).toEqual({ value: 2000, unit: "px" });
    expect(parseImageWidth("500%")).toEqual({ value: 100, unit: "%" });
    expect(parseImageWidth("0")).toBeUndefined();
    expect(parseImageWidth(undefined)).toBeUndefined();
    expect(parseImageWidth("")).toBeUndefined();
  });

  /** Each inlined image is a request issued at mount; past the cap the chip still renders but makes no call. */
  it("stops inlining past the per-document cap", () => {
    const src = Array.from(
      { length: MAX_INLINE_IMAGES + 3 },
      (_, i) => `img(https://i.imgur.com/${i}.png)`,
    ).join(" ");
    const chips = chipsOf(src);

    expect(chips).toHaveLength(MAX_INLINE_IMAGES + 3);
    expect(chips.filter((c) => !("capped" in c))).toHaveLength(MAX_INLINE_IMAGES);
    expect(chips.filter((c) => "capped" in c)).toHaveLength(3);
    // In document order: it is the last ones that stop, not an arbitrary set.
    expect(chips.slice(0, MAX_INLINE_IMAGES).every((c) => !("capped" in c))).toBe(true);
  });

  it("handles an image nested inside a link, as real bios write it", () => {
    // `[img33(url) ](target)` — a linked image. Both survive, in that order.
    const nodes = parse(`[img33(https://i.imgur.com/a.png) ](https://myanimelist.net/x)`);
    // The markdown spelling of the same idiom; the label's own `]` must not end the link's label early.
    const md = parse(`[![badge](https://i.imgur.com/b.png)](https://example.com/me)`);
    const link = (md[0] as { children: MdInline[] }).children[0];
    expect(link).toMatchObject({ type: "link", href: "https://example.com/me" });
    expect((link as { children: MdInline[] }).children[0]).toMatchObject({
      type: "chip",
      kind: "image",
      href: "https://i.imgur.com/b.png",
    });
    const kinds = types(nodes);
    expect(kinds).toContain("link");
    expect(kinds).toContain("chip");
  });
});

describe("block structure", () => {
  it("makes a single newline a break and a blank line a new paragraph", () => {
    // Most real bios are line-oriented, and collapsing newlines would render each as a single blob.
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

  it("reads a hashtag at the start of a line as a heading, as the site does", () => {
    // marked's heading rule, which anilist.co runs, needs no space after the `#`; matching the site is the point.
    expect(parse(`#nothashtag`)[0]).toMatchObject({ type: "h", level: 1 });
    expect(parse(`#__Day 235__`)[0]).toMatchObject({ type: "h", level: 1 });
    expect(types(parse(`#__Day 235__`))).toContain("strong");
    // A bare `#` has nothing to head.
    expect(parse(`#`)[0].type).toBe("p");
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

    // Content on the opening fence's own line, which real bios write and a bare-line rule shows as literal `~~~`.
    const trailing = parse(`~~~ ren | they/them\n\n[insta](https://instagram.com/x)\n\n~~~`);
    expect(trailing[0].type).toBe("center");
    expect(textOf(trailing)).toContain("they/them");
    expect(textOf(trailing)).not.toContain("~~~");
    expect(types(trailing)).toContain("link");
  });

  it("leaves no fence marker in the rendered text, in any spelling", () => {
    for (const src of [
      `~~~ trailing content\nmore\n~~~`,
      `~~~\nbare\n~~~`,
      `~~~one line~~~`,
      `~~~ unclosed content`,
      // The closing fence glued to the last content line, as real bios end.
      `~~~ opening\nimg220(https://i.imgur.com/a.jpg)~~~`,
    ]) {
      expect(textOf(parse(src)), src).not.toContain("~~~");
    }
  });

  it("keeps the closing line's content when the fence is glued to it", () => {
    // The shape of the maintainer's own bio: a multi-line centred block with the close glued to the last image.
    const nodes = parse(
      `~~~__Hi.__\n[a link](https://example.com)\n\n` +
        `img220(https://i.imgur.com/a.jpeg)\n\n\n` +
        `Prose line.\nimg220(https://i.imgur.com/b.jpg)~~~`,
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("center");
    const inner = types(nodes);
    expect(inner).toContain("strong");
    expect(inner).toContain("link");
    // Both images survived — the glued one included.
    const chips = JSON.stringify(nodes).match(/"chip"/g);
    expect(chips).toHaveLength(2);
    expect(textOf(nodes)).not.toContain("~~~");
    expect(textOf(nodes)).toContain("Prose line.");
  });

  it("renders table rows as cell text rather than dropping them", () => {
    const nodes = parse(`| a | b |\n| --- | --- |\n| c | d |`);
    const text = textOf(nodes);
    expect(text).toContain("a");
    expect(text).toContain("d");
    expect(types(nodes)).not.toContain("table");
  });
});

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

  it("never puts a spoiler's text in a preview", () => {
    // A preview is exactly where a spoiler leaks: the profile's comment list shows the first lines of every comment.
    expect(renderPlain(`~!secret!~ did it`)).toBe("[…] did it");
    expect(renderPlain(`before\n~!\nsecret\n\nlines\n!~\nafter`)).toBe("before […] after");
    expect(renderPlain(`~!secret!~`, 200, "Spoiler")).toBe("Spoiler");
    expect(renderPlain(`~!secret!~`)).not.toContain("secret");
  });

  it("flattens accent decoration into its text", () => {
    // Without the `accent` case in the walk, the arrow is silently gone from the preview.
    expect(renderPlain(`18<a>&#8593;</a>`)).toBe("18↑");
  });
});

describe("one-line centred HTML rows", () => {
  it("does not read a leading dash as a bullet", () => {
    const nodes = parse(`<div align="center">- <a>&#x2727;</a> -</div>`);
    expect(nodes.map((n) => n.type)).toEqual(["center"]);
    const inner = (nodes[0] as { children: { type: string }[] }).children;
    expect(inner.map((n) => n.type)).toEqual(["p"]);
    expect(textOf(nodes)).toBe("- ✧ -");
  });

  it("still reads the HTML heading such rows are made of", () => {
    const nodes = parse(`<div align="center"><h5>click to <a>add</a> me</h5></div>`);
    expect(types(nodes)).toContain("h");
    expect(types(nodes)).not.toContain("p");
    expect(textOf(nodes)).toBe("click to add me");
  });

  it("keeps the markdown reading for a block that spans lines", () => {
    // Unmeasured on the site; the multi-line `<center>` case is the nearest evidence and points this way.
    const src = `<center>
- a
- b
</center>`;
    expect(types(parse(src))).toContain("list");
  });
});

describe("<hr> on its own line", () => {
  it("is a rule, not a dropped tag", () => {
    expect(parse(`a\n<hr>\nb`).map((n) => n.type)).toEqual(["p", "hr", "p"]);
    expect(parse(`<hr />`)[0].type).toBe("hr");
  });
});

describe("what the site draws inside a multi-line <center>", () => {
  it("reads #__bold link__ rows as headings, <hr> as a rule and a bare URL as a link", () => {
    const src = `<center>
#__[365 Days Anime Challenge](https://anilist.co/forum/thread/85412)__
Will be curious to compare this to my 100 day anime and manga challenge answers
<hr>
#__Day 235: Series that would make for a good video game__
https://anilist.co/anime/20800
</center>`;
    const nodes = parse(src);
    expect(nodes.map((n) => n.type)).toEqual(["center"]);
    const inner = (nodes[0] as { children: { type: string }[] }).children;
    expect(inner.map((n) => n.type)).toEqual(["h", "p", "hr", "h", "p"]);
    expect(types(nodes).filter((t) => t === "link")).toHaveLength(2);
    expect(types(nodes).filter((t) => t === "strong")).toHaveLength(2);
  });
});
