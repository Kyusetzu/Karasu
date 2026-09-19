import { describe, expect, it } from "vitest";
import type { MdInline } from "./anilistMarkdown";
import {
  renderPlain,
} from "./anilistMarkdown";
import {
  parse,
  textOf,
  types,
} from "@/test/markdown";

/** The inline vocabulary: emphasis, links, mentions, entities and the inline centre marker. */

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
    // Greedy matching lacks CommonMark's delimiter-run algorithm, so the outer strong wins and nothing is lost.
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
    // AniList runs markdown-it, and the `_` half is load-bearing: without it `snake_case_name` renders half italic.
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

  it("reads `~!!~` as an empty spoiler, as anilist.co does", () => {
    const n = first(`a ~!!~ b`)[1];
    expect(n).toMatchObject({ type: "spoiler", children: [] });
  });
});

describe("entities", () => {
  it("decodes named, decimal and hex forms in text", () => {
    // Verify the non-ASCII expectations by codepoint, not by eye; the console codepage hides mojibake.
    expect(textOf(parse(`stars &starf; and &#9825; and &#x2605;`))).toBe(
      "stars ★ and ♡ and ★",
    );
    expect(textOf(parse(`likes back &sol; follows back`))).toBe(
      "likes back / follows back",
    );
    expect(textOf(parse(`A &amp; B&hellip;`))).toBe("A & B…");
  });

  it("keeps &nbsp; as a real no-break space", () => {
    expect(textOf(parse(`a&nbsp;b`))).toBe("a b");
  });

  it("leaves an unknown or malformed entity as literal text", () => {
    expect(textOf(parse(`&doesnotexist; &fake`))).toBe("&doesnotexist; &fake");
  });

  it("refuses surrogate and out-of-range codepoints", () => {
    expect(textOf(parse(`&#xD800; &#1114112; &#0;`))).toBe("&#xD800; &#1114112; &#0;");
  });

  it("decodes an entity-encoded tag to characters, never to markup", () => {
    // Decoded after parsing, so this is visible text React escapes; not in HOSTILE because these brackets are content.
    const nodes = parse(`&lt;script&gt;alert(1)&lt;/script&gt;`);
    expect(types(nodes)).not.toContain("codeBlock");
    expect(textOf(nodes)).toBe("<script>alert(1)</script>");
  });

  it("keeps entities raw inside code spans", () => {
    // markdown-it does the same: a code span is verbatim.
    expect(textOf(parse("`a &amp; b`"))).toBe("a &amp; b");
  });

  it("decodes an entity inside a URL before judging it", () => {
    // CommonMark decodes link destinations, and the scheme whitelist runs on the decoded bytes to catch smuggling.
    const n = parse(`[x](https://a.co/?a=1&amp;b=2)`)[0] as { children: MdInline[] };
    expect(n.children[0]).toMatchObject({ type: "link", href: "https://a.co/?a=1&b=2" });
    expect(types(parse(`[x](java&#115;cript:alert(1))`))).not.toContain("link");
  });

});

describe("entities, the whole browser set", () => {
  it("decodes names the hand-picked table did not know", () => {
    // `&plus;` is straight out of a real bio, where the site shows a plus sign.
    expect(textOf(parse(`18 &plus; &check; &frac12;`))).toBe("18 + ✓ ½");
  });

  it("is case-sensitive, like a browser", () => {
    expect(textOf(parse(`&Dagger;&dagger;`))).toBe("‡†");
    expect(textOf(parse(`&NBSP;`))).toBe("&NBSP;");
  });

  it("does not answer an entity with an Object property", () => {
    // Both fit the name pattern, and a plain-object lookup answers them with functions rather than glyphs.
    expect(textOf(parse(`&constructor; &toString;`))).toBe("&constructor; &toString;");
  });
});

describe("inline ~~~centre~~~", () => {
  it("centres part of a heading and keeps the spoiler after it", () => {
    const nodes = parse(
      `# ~~~4. Favorite Male Character~~~ ~~~~!img450(https://i.imgur.com/a.png)!~ ~~~`,
    );
    expect(nodes.map((n) => n.type)).toEqual(["h"]);
    const t = types(nodes);
    expect(t.filter((x) => x === "centered")).toHaveLength(2);
    expect(t).toContain("spoiler");
    expect(t).toContain("chip");
    expect(t).not.toContain("strike");
    expect(textOf(nodes)).toContain("4. Favorite Male Character");
  });

  it("leaves two tildes to strike-through and a lone triple literal", () => {
    expect(types(parse(`a ~~gone~~ b`))).toContain("strike");
    expect(textOf(parse(`a ~~~ b`))).toBe("a ~~~ b");
  });

  it("previews its text and counts its images toward the fan-out cap", () => {
    expect(renderPlain(`# ~~~Title~~~`)).toBe("Title");
    const many = Array.from(
      { length: 30 },
      (_, i) => `~~~img(https://i.imgur.com/${i}.png)~~~`,
    ).join(" ");
    const capped = JSON.stringify(parse(`# ${many}`)).match(/"capped":true/g) ?? [];
    expect(capped).toHaveLength(6);
  });
});
