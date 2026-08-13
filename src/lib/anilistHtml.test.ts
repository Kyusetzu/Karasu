import { describe, expect, it } from "vitest";
import { htmlToPlain, parseAniListHtml } from "./anilistHtml";
import type { MdInline } from "./anilistMarkdown";

const OK = new Set([
  "text", "strong", "em", "strike", "code", "link", "mention", "spoiler", "chip", "br",
]);

function walk(nodes: MdInline[], visit: (n: MdInline) => void): void {
  for (const n of nodes) {
    visit(n);
    if ("children" in n && Array.isArray(n.children)) walk(n.children, visit);
  }
}

function types(nodes: MdInline[]): string[] {
  const out: string[] = [];
  walk(nodes, (n) => out.push(n.type));
  return out;
}

function textOf(nodes: MdInline[]): string {
  let s = "";
  walk(nodes, (n) => {
    if (n.type === "text") s += n.text;
  });
  return s;
}

describe("the five tags the old sanitizer allowed", () => {
  it("keeps bold and italic, collapsing the synonymous pairs", () => {
    // `<b>` and `<strong>` render identically, as do `<i>` and `<em>`, so one
    // node each loses nothing visible and halves the cases downstream.
    expect(types(parseAniListHtml("<b>a</b>"))).toContain("strong");
    expect(types(parseAniListHtml("<strong>a</strong>"))).toContain("strong");
    expect(types(parseAniListHtml("<i>a</i>"))).toContain("em");
    expect(types(parseAniListHtml("<em>a</em>"))).toContain("em");
  });

  it("keeps line breaks in every spelling", () => {
    for (const src of ["<br>", "<br/>", "<br />", "<BR>"]) {
      expect(types(parseAniListHtml(src)), src).toContain("br");
    }
  });

  it("nests emphasis", () => {
    const nodes = parseAniListHtml("<b>bold <i>and italic</i></b>");
    expect(nodes[0].type).toBe("strong");
    expect(types(nodes)).toContain("em");
    expect(textOf(nodes)).toBe("bold and italic");
  });
});

describe("everything the old sanitizer dropped", () => {
  it("drops the tag and keeps the words", () => {
    expect(textOf(parseAniListHtml("<a href='#'>link</a>"))).toBe("link");
    expect(textOf(parseAniListHtml("<div class=x><span>text</span></div>"))).toBe("text");
  });

  it("drops an attribute-carrying allowed tag's attributes with no trace", () => {
    // The exact hole the sanitizer's comment describes: `\b` matched at the
    // space before an attribute, so `<b onmouseover=…>` passed through whole.
    // Here the attributes cannot survive, because nothing carries them.
    const nodes = parseAniListHtml('<b onmouseover="alert(1)">hi</b>');
    expect(nodes[0].type).toBe("strong");
    expect(textOf(nodes)).toBe("hi");
    walk(nodes, (n) => {
      for (const key of Object.keys(n)) {
        expect(["type", "text", "children"]).toContain(key);
      }
    });
  });

  it("drops a script or style body entirely, contents included", () => {
    expect(textOf(parseAniListHtml("<script>alert(1)</script>hi"))).toBe("hi");
    expect(textOf(parseAniListHtml("<style>b{}</style>hi"))).toBe("hi");
    // The old sanitizer left `alert(1)` behind as visible text.
    expect(textOf(parseAniListHtml("<script>alert(1)</script>"))).toBe("");
  });

  it("drops comments, doctypes and images", () => {
    expect(textOf(parseAniListHtml("<!-- c -->text"))).toBe("text");
    expect(textOf(parseAniListHtml("<!DOCTYPE html>text"))).toBe("text");
    expect(textOf(parseAniListHtml("<img src=x onerror=alert(1)>"))).toBe("");
  });

  it("emits no node type outside the shared union", () => {
    for (const src of [
      '<b onmouseover=alert(1)>x</b>',
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "<svg/onload=alert(1)>",
      "<iframe src=javascript:alert(1)></iframe>",
      "<div\nunclosed",
      "~!spoiler!~",
      "&lt;script&gt;",
    ]) {
      walk(parseAniListHtml(src), (n) => {
        expect(OK.has(n.type), `${n.type} from ${src}`).toBe(true);
      });
    }
  });
});

describe("unbalanced markup", () => {
  it("keeps the words when a tag never closes", () => {
    const nodes = parseAniListHtml("<b>never closed");
    expect(nodes[0].type).toBe("strong");
    expect(textOf(nodes)).toBe("never closed");
  });

  it("drops a close tag that never opened", () => {
    expect(textOf(parseAniListHtml("</b>text"))).toBe("text");
    expect(types(parseAniListHtml("</b>text"))).not.toContain("strong");
  });

  it("unwinds crossed tags rather than leaking a frame", () => {
    // `<b><i>x</b>` is malformed and real. Closing the outer tag closes both.
    const nodes = parseAniListHtml("<b><i>x</b>y");
    expect(textOf(nodes)).toBe("xy");
    expect(types(nodes)).toContain("strong");
  });

  it("cannot overflow the stack, however deep the nesting", () => {
    // An explicit stack rather than recursion is why. 2,000 opens, none closed
    // — and 2,000 rather than 5,000 because `<b>` is three characters, so 5,000
    // of them exceed the 8,000-character limit and the trailing `x` is truncated
    // away. That is the bound working; this test is about the stack.
    const deep = "<b>".repeat(2000) + "x";
    expect(deep.length).toBeLessThan(8000);
    expect(() => parseAniListHtml(deep)).not.toThrow();
    expect(textOf(parseAniListHtml(deep))).toBe("x");
  });

  it("truncates past the limit rather than parsing an unbounded description", () => {
    const long = `${"a".repeat(8000)}TAIL`;
    expect(textOf(parseAniListHtml(long))).not.toContain("TAIL");
    expect(textOf(parseAniListHtml(long, 8100))).toContain("TAIL");
  });

  it("terminates on pathological input", () => {
    const started = Date.now();
    for (const src of [
      "<".repeat(5000),
      "&".repeat(5000),
      "~!".repeat(2000),
      "<b>".repeat(2000) + "</b>".repeat(2000),
      "x".repeat(50_000),
      "&#".repeat(3000),
    ]) {
      expect(() => parseAniListHtml(src)).not.toThrow();
    }
    expect(Date.now() - started).toBeLessThan(4000);
  });
});

describe("entities", () => {
  it("decodes the named ones descriptions actually use", () => {
    // `&nbsp;` becomes a real U+00A0 rather than a space — an author writing it
    // wants the line not to break there.
    expect(textOf(parseAniListHtml("&amp;&lt;&gt;&quot;&nbsp;"))).toBe('&<>" ');
    expect(textOf(parseAniListHtml("a&mdash;b&hellip;"))).toBe("a—b…");
  });

  it("decodes numeric and hex forms", () => {
    expect(textOf(parseAniListHtml("&#65;&#x42;"))).toBe("AB");
  });

  it("leaves an unknown or malformed entity as literal text", () => {
    expect(textOf(parseAniListHtml("&notreal;"))).toBe("&notreal;");
    expect(textOf(parseAniListHtml("5 & 6"))).toBe("5 & 6");
  });

  it("refuses a surrogate or out-of-range code point", () => {
    // `String.fromCodePoint` would throw on the second and yield half a pair on
    // the first, so both stay literal.
    expect(textOf(parseAniListHtml("&#xD800;"))).toBe("&#xD800;");
    expect(textOf(parseAniListHtml("&#1114112;"))).toBe("&#1114112;");
  });

  it("does not turn an escaped tag back into a tag", () => {
    // `&lt;script&gt;` must stay text. It decodes to characters, not markup,
    // because the decode happens after parsing rather than before.
    const nodes = parseAniListHtml("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(textOf(nodes)).toBe("<script>alert(1)</script>");
    expect(types(nodes)).toEqual(["text"]);
  });
});

describe("spoilers", () => {
  it("keeps the text behind a spoiler node instead of deleting it", () => {
    // A behaviour change from the sanitizer, which removed spoilers *and their
    // contents* — silently dropping part of the synopsis. The renderer keeps
    // spoiler text out of the DOM until it is asked for, so nothing is spoiled
    // and nothing is lost.
    const nodes = parseAniListHtml("safe ~!he dies!~ safe");
    expect(types(nodes)).toContain("spoiler");
    expect(textOf(nodes)).toContain("he dies");
  });

  it("parses markup inside a spoiler", () => {
    expect(types(parseAniListHtml("~!<b>bold reveal</b>!~"))).toContain("strong");
  });

  it("leaves an unclosed spoiler marker as text", () => {
    expect(types(parseAniListHtml("~!never closed"))).not.toContain("spoiler");
  });
});

describe("htmlToPlain", () => {
  it("returns the visible words only", () => {
    expect(htmlToPlain("<b>A</b> <i>synopsis</i>.<br>Second line.")).toBe(
      "A synopsis. Second line.",
    );
  });

  it("collapses whitespace and trims", () => {
    expect(htmlToPlain("  a\n\n  b  ")).toBe("a b");
  });

  it("includes spoiler text, so callers must not use it for a preview", () => {
    // Documented rather than asserted as safety: the renderer hides spoilers,
    // this flattens everything, and a preview is not a place for a reveal.
    expect(htmlToPlain("~!secret!~")).toBe("secret");
  });
});
