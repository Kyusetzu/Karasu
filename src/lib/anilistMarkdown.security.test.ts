import { describe, expect, it } from "vitest";
import type { MdInline } from "./anilistMarkdown";
import {
  parseAniListMarkdown,
} from "./anilistMarkdown";
import {
  ALLOWED_FIELDS,
  BLOCK_TYPES,
  INLINE_TYPES,
  chipsOf,
  parse,
  textOf,
  types,
  walk,
} from "@/test/markdown";

/** What the parser must never let through: script, raw HTML and anything past the size bounds. */

describe("the tree cannot carry executable content", () => {
  // Deliberately nasty and drawn from real bios: raw tags, event handlers, and AniList's own layout blob.
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
    `<a href=javascript:alert(1)>y</a>`,
    `<a href='DATA:text/html,x'>z</a>`,
    // Entity-smuggled schemes: decoded before the whitelist, so they fail it.
    `[click](java&#115;cript:alert(1))`,
    `<a href="&#106;avascript:alert(1)">x</a>`,
    `<img src="j&#97;vascript:alert(1)">`,
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

  /** A leading slash would take RichText's internal branch and hand a foreign host to the router. */
  it("refuses protocol-relative URLs outright", () => {
    const nodes = parse("[click](//evil.example/pwn) and //evil.example/raw");
    walk(nodes, (n) => {
      expect(n.type, "no link node may come from a protocol-relative href").not.toBe("link");
    });
    // The label's words survive as plain text — the link just is not one.
    expect(textOf(nodes)).toContain("click");
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

describe("raw HTML drops the tag and keeps the words", () => {
  it("keeps the text inside a tag with a handler", () => {
    expect(textOf(parse(`<b onmouseover=alert(1)>hi</b>`))).toBe("hi");
  });

  it("drops a script or style body entirely, contents included", () => {
    // Every other element's text is prose worth keeping; theirs is code nobody meant to read.
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
    // `x` is not a URL, so not even a chip — and the handler is never read.
    expect(types(parse(`<img src=x onerror=alert(1)>`))).not.toContain("chip");
  });

  it("reads a URL with balanced parentheses whole, and drops a title", () => {
    expect(chipsOf(`img(https://upload.wikimedia.org/x_(1).png)`)[0]).toMatchObject({
      href: "https://upload.wikimedia.org/x_(1).png",
    });
    expect(chipsOf(`![alt](https://i.imgur.com/a.png "the title")`)[0]).toMatchObject({
      href: "https://i.imgur.com/a.png",
    });
    const n = parse(`[Wiki](https://en.wikipedia.org/wiki/Foo_(bar) 'title')`)[0] as { children: MdInline[] };
    expect(n.children[0]).toMatchObject({ type: "link", href: "https://en.wikipedia.org/wiki/Foo_(bar)" });
    // An unclosed target is not a markdown link: the bracket stays as text and only the bare URL autolinks.
    const open = parse(`[x](https://a.co`)[0] as { children: MdInline[] };
    expect(textOf([open.children[0]])).toBe("[x](");
    expect(open.children[1]).toMatchObject({ type: "link", href: "https://a.co" });
  });

  it("reads an <img> tag as the image it is, size included", () => {
    const [c] = chipsOf(`<img src="https://i.imgur.com/a.png" width="220" alt="badge">`);
    expect(c).toMatchObject({ kind: "image", href: "https://i.imgur.com/a.png", width: { value: 220, unit: "px" } });
    expect(chipsOf(`<img width='50%' src='https://i.imgur.com/b.png'>`)[0]).toMatchObject({
      width: { value: 50, unit: "%" },
    });
    expect(chipsOf(`<img alt="no source">`)).toHaveLength(0);
  });

  it("keeps a linked <img> inside its <a>", () => {
    const n = parse(`<a href="https://steamcommunity.com/id/x"><img src="https://i.imgur.com/steam.png"></a>`)[0] as {
      children: MdInline[];
    };
    const link = n.children[0];
    expect(link).toMatchObject({ type: "link", href: "https://steamcommunity.com/id/x" });
    expect((link as { children: MdInline[] }).children[0]).toMatchObject({ type: "chip", kind: "image" });
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
    // Nodes are only created on a complete match, so a split delimiter can only degrade to text.
    const r = parseAniListMarkdown(`${"x".repeat(7998)}**bold**`, { limit: 8000 });
    expect(r.truncated).toBe(true);
    walk(r.nodes, (n) => {
      expect(BLOCK_TYPES.has(n.type) || INLINE_TYPES.has(n.type)).toBe(true);
    });
  });

  it("does not let a nested match rewind the outer scan", () => {
    // Keep every branch advancing by the match's own length; recursive `parseInline` resets a shared `lastIndex`.
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
      "<b>".repeat(2600),
      "<a href=x>".repeat(800),
      `${'<div align="center">'.repeat(400)}x`,
      "&amp".repeat(2000),
      "&#x2605;".repeat(1000),
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
      `~~~ ren | they/them | de\n\n[instagram ](https://www.instagram.com/x/) + ` +
      `[spotify](https://open.spotify.com/user/y?si=z&utm_source=copy-link)\n\n~~~`;
    const r = parseAniListMarkdown(real);
    expect(r.truncated).toBe(false);
    expect(types(r.nodes)).toContain("center");
    expect(types(r.nodes)).toContain("chip");
    expect(textOf(r.nodes)).toContain("they/them");
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

describe("inline HTML kept as structure", () => {
  const first = (src: string) => (parse(src)[0] as { children: MdInline[] }).children;

  it("maps every paired styling tag onto its markdown node", () => {
    for (const [tag, type] of [
      ["b", "strong"],
      ["strong", "strong"],
      ["i", "em"],
      ["em", "em"],
      ["s", "strike"],
      ["del", "strike"],
      ["strike", "strike"],
    ] as const) {
      const n = first(`<${tag}>x</${tag}>`)[0];
      expect(n.type, tag).toBe(type);
      expect(textOf([n]), tag).toBe("x");
    }
  });

  it("parses the pair's inner content", () => {
    const n = first(`<b>bold &amp; **strong**</b>`)[0];
    expect(n.type).toBe("strong");
    expect(textOf([n])).toBe("bold & strong");
  });

  it("degrades an unclosed styling tag to plain text, as before", () => {
    const nodes = parse(`<b>never closed`);
    expect(types(nodes)).not.toContain("strong");
    expect(textOf(nodes)).toBe("never closed");
  });

  it("turns <a href> into a link with parsed children", () => {
    const n = first(`<a href="https://anilist.co/user/x">me</a>`)[0];
    expect(n).toMatchObject({ type: "link", href: "https://anilist.co/user/x" });
    expect(textOf([n])).toBe("me");
  });

  it("keeps a linked image inside the link — the favicon-row idiom", () => {
    // One click target: the chip sits inside the link's children, the same shape `[img33(u)](t)` produces.
    const n = first(
      `<a href="https://steamcommunity.com/id/x">img16(https://a.favicon.im/steamcommunity.com)</a>`,
    )[0];
    expect(n).toMatchObject({ type: "link", href: "https://steamcommunity.com/id/x" });
    expect(types([n])).toContain("chip");
  });

  it("turns a bare <a> into accent decoration", () => {
    const n = first(`<a>&#x2605;</a>`)[0];
    expect(n.type).toBe("accent");
    expect(textOf([n])).toBe("★");
  });

  // anilist.co strips a refused target to a bare `<a>` and colours it like any anchor: colour, never a link.
  it("renders a rejected href as accent decoration, never as a link", () => {
    for (const src of [
      `<a href="javascript:alert(1)">x</a>`,
      `<a href="">x</a>`,
      `<a href="jsonN4IgDg">x</a>`,
      `[x](javascript:;)`,
      `[x](data:text/html,y)`,
    ]) {
      const kinds = types(parse(src));
      expect(kinds, src).not.toContain("link");
      expect(kinds, src).toContain("accent");
      expect(textOf(parse(src)), src).toBe("x");
    }
    // The layout blob: an empty label leaves an empty accent, nothing to see.
    expect(textOf(parse(`[](jsonN4IgDglgdlCmAmIBcAWA7ADgMwFY0EYMAmAXyA==)`))).toBe("");
  });
});

describe("block HTML kept as structure", () => {
  it("centres <center> and align=center in every real spelling", () => {
    for (const src of [
      `<center>x</center>`,
      `<div align="center">x</div>`,
      `<div align='center'>x</div>`,
      `<div align=center>x</div>`,
      `<DIV ALIGN="CENTER">x</DIV>`,
      `<p align="center">x</p>`,
    ]) {
      const nodes = parse(src);
      expect(nodes[0]?.type, src).toBe("center");
      expect(textOf(nodes), src).toBe("x");
    }
  });

  it("leaves a div without align=center as dropped-tag prose", () => {
    const nodes = parse(`<div class="x">art</div>`);
    expect(types(nodes)).not.toContain("center");
    expect(textOf(nodes)).toBe("art");
  });

  it("spans multiple lines and is not closed early by a nested div", () => {
    const nodes = parse(
      `<div align="center">\nline one\n<div>nested</div>\nline two\n</div>\nafter`,
    );
    expect(nodes[0].type).toBe("center");
    const centred = textOf([nodes[0]]);
    expect(centred).toContain("line one");
    expect(centred).toContain("nested");
    expect(centred).toContain("line two");
    expect(textOf([nodes[1]])).toBe("after");
  });

  it("keeps the rest of the input when the opener never closes — like ~~~", () => {
    const nodes = parse(`<div align="center">\neverything\nhere`);
    expect(nodes[0].type).toBe("center");
    expect(textOf(nodes)).toContain("everything");
    expect(textOf(nodes)).toContain("here");
  });

  it("breaks a paragraph before a centred line instead of swallowing it", () => {
    const nodes = parse(`prose line\n<div align="center">centred</div>`);
    expect(types(nodes)).toContain("center");
    expect(textOf([nodes[0]])).toContain("prose line");
  });

  it("parses an HTML heading alone on its line", () => {
    const n = parse(`<h5>small title</h5>`)[0];
    expect(n).toMatchObject({ type: "h", level: 5 });
    expect(textOf([n])).toBe("small title");
  });

  it("renders the fixture profile's shape — the bug that started this", () => {
    // Distilled from a real bio: entity spacers, centred divs, an h5 with bare-<a> decoration, a linked favicon.
    const real =
      `&nbsp;\n` +
      `<div align="center"><h5>˗ˏˋ <a>&#x2605;</a> ˎˊ˗</h5></div>\n` +
      `<div align="center">18<a>&#8593;</a></div>\n` +
      `<div align="center">likes back <a>&sol;</a> follows back</div>\n` +
      `<div align="center">img89(https://static2.klipy.com/x.gif)</div>\n` +
      `<div align="center"><a href="https://steamcommunity.com/id/x">img16(https://a.favicon.im/steamcommunity.com)</a></div>`;
    const r = parseAniListMarkdown(real);
    const kinds = types(r.nodes);
    expect(kinds).toContain("center");
    expect(kinds).toContain("h");
    expect(kinds).toContain("accent");
    expect(kinds).toContain("link");
    expect(kinds).toContain("chip");
    const text = textOf(r.nodes);
    expect(text).toContain("★");
    expect(text).toContain("18↑");
    expect(text).toContain("likes back / follows back");
  });
});
