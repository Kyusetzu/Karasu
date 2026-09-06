import { describe, expect, it } from "vitest";
import { parseAniListMarkdown, type MdInline, type MdNode } from "./anilistMarkdown";
import {
  cycleHeading,
  editSpan,
  fenceCode,
  INLINE_MARKS,
  insertImage,
  insertLink,
  insertVideo,
  prefixLines,
  wrapCenter,
  wrapSelection,
} from "./composer";

const types = (nodes: (MdNode | MdInline)[]): string[] => {
  const out: string[] = [];
  const walk = (list: (MdNode | MdInline)[]) => {
    for (const n of list) {
      out.push(n.type);
      if ("children" in n && Array.isArray(n.children)) walk(n.children);
      if (n.type === "list") for (const item of n.items) walk(item);
    }
  };
  walk(nodes);
  return out;
};

describe("wrapSelection", () => {
  it("wraps a selection and selects the inside", () => {
    expect(wrapSelection("a sel b", 2, 5, "**", "**")).toEqual({ text: "a **sel** b", start: 4, end: 7 });
  });

  it("gives the selection's outer whitespace back to the outside", () => {
    // `** x**` is not bold to the parser, so the space must not be wrapped.
    expect(wrapSelection("a sel b", 1, 6, "**", "**")).toEqual({ text: "a **sel** b", start: 4, end: 7 });
  });

  it("toggles off from outside and from inside", () => {
    expect(wrapSelection("a **sel** b", 4, 7, "**", "**")).toEqual({ text: "a sel b", start: 2, end: 5 });
    expect(wrapSelection("a **sel** b", 2, 9, "**", "**")).toEqual({ text: "a sel b", start: 2, end: 5 });
  });

  it("wraps italic inside bold rather than reading bold's second star as italic", () => {
    expect(wrapSelection("**word**", 2, 6, "*", "*").text).toBe("***word***");
    expect(wrapSelection("***word***", 3, 7, "*", "*").text).toBe("**word**");
  });

  it("inserts the markers with the caret between them when nothing is selected", () => {
    expect(wrapSelection("ab", 1, 1, "~!", "!~")).toEqual({ text: "a~!!~b", start: 3, end: 3 });
  });

  it("accepts a backwards selection", () => {
    expect(wrapSelection("a sel b", 5, 2, "*", "*")).toEqual({ text: "a *sel* b", start: 3, end: 6 });
  });

  it("produces what the parser reads as the intended node", () => {
    for (const [mark, node] of [
      ["bold", "strong"],
      ["italic", "em"],
      ["strike", "strike"],
      ["spoiler", "spoiler"],
      ["code", "code"],
    ] as const) {
      const [b, a] = INLINE_MARKS[mark];
      const { text } = wrapSelection("say hello there", 4, 9, b, a);
      expect(types(parseAniListMarkdown(text).nodes), mark).toContain(node);
    }
  });
});

describe("prefixLines", () => {
  it("prefixes every touched line and selects the block", () => {
    expect(prefixLines("one\ntwo\nthree", 1, 6, "quote")).toEqual({
      text: "> one\n> two\nthree",
      start: 0,
      end: 11,
    });
    expect(prefixLines("one\ntwo", 0, 0, "bullet").text).toBe("- one\ntwo");
  });

  it("toggles off when every line already carries the prefix", () => {
    expect(prefixLines("> a\n> b", 0, 7, "quote").text).toBe("a\nb");
    expect(prefixLines("- a\n- b", 0, 7, "bullet").text).toBe("a\nb");
  });

  it("numbers from one and renumbers what was there", () => {
    expect(prefixLines("a\n7. b\nc", 0, 8, "numbered").text).toBe("1. a\n2. b\n3. c");
    expect(prefixLines("1. a\n2. b", 0, 9, "numbered").text).toBe("a\nb");
  });

  it("replaces a heading level rather than stacking one", () => {
    expect(prefixLines("## title", 0, 0, { heading: 3 }).text).toBe("### title");
    expect(prefixLines("### title", 0, 0, { heading: 3 }).text).toBe("title");
  });

  it("does not pull in the line after a selection that ends on a newline", () => {
    expect(prefixLines("a\nb\nc", 0, 2, "quote").text).toBe("> a\nb\nc");
  });
});

describe("cycleHeading", () => {
  it("steps none → ## → ### → #### → none", () => {
    let text = "title";
    const step = () => {
      text = cycleHeading(text, 0, 0).text;
      return text;
    };
    expect(step()).toBe("## title");
    expect(step()).toBe("### title");
    expect(step()).toBe("#### title");
    expect(step()).toBe("title");
  });
});

describe("insertLink", () => {
  it("makes a selected URL the target and leaves the caret in the label", () => {
    expect(insertLink("see https://a.co now", 4, 16)).toEqual({
      text: "see [](https://a.co) now",
      start: 5,
      end: 5,
    });
  });

  it("makes selected text the label with `url` selected for typing over", () => {
    expect(insertLink("see this now", 4, 8)).toEqual({ text: "see [this](url) now", start: 11, end: 14 });
  });

  it("inserts an empty link with the caret in the label", () => {
    expect(insertLink("ab", 1, 1)).toEqual({ text: "a[]()b", start: 2, end: 2 });
  });
});

describe("image, video, centre and code", () => {
  it("wrap the selection in AniList's own call forms", () => {
    expect(insertImage("x https://i.co/a.png y", 2, 20).text).toBe("x img(https://i.co/a.png) y");
    expect(insertVideo("id", 0, 2).text).toBe("youtube(id)");
    expect(insertImage("ab", 1, 1)).toEqual({ text: "aimg()b", start: 5, end: 5 });
  });

  it("centre on one line, fenced across lines", () => {
    expect(wrapCenter("hi", 0, 2).text).toBe("~~~hi~~~");
    expect(wrapCenter("a\nb", 0, 3).text).toBe("~~~\na\nb\n~~~");
    expect(types(parseAniListMarkdown(wrapCenter("a\nb", 0, 3).text).nodes)).toContain("center");
  });

  it("inline code on one line, a fence on its own lines across lines", () => {
    expect(fenceCode("x y", 0, 1).text).toBe("`x` y");
    expect(fenceCode("pre\na\nb\npost", 4, 7).text).toBe("pre\n```\na\nb\n```\npost");
    expect(types(parseAniListMarkdown(fenceCode("a\nb", 0, 3).text).nodes)).toContain("codeBlock");
  });
});

describe("editSpan", () => {
  it("finds the smallest replacement", () => {
    // Wrapping `sel` in `**…**` is one insertion at 2 plus one at 5; the
    // span form has to widen to cover both, replacing `sel` with `**sel**`.
    expect(editSpan("a sel b", "a **sel** b")).toEqual({ start: 2, end: 5, insert: "**sel**" });
  });

  it("covers an insert, a replace and a no-op", () => {
    expect(editSpan("ab", "aXb")).toEqual({ start: 1, end: 1, insert: "X" });
    expect(editSpan("a **sel** b", "a sel b")).toEqual({ start: 2, end: 9, insert: "sel" });
    expect(editSpan("same", "same")).toEqual({ start: 4, end: 4, insert: "" });
    expect(editSpan("", "new")).toEqual({ start: 0, end: 0, insert: "new" });
  });

  it("does not let the prefix and suffix overlap", () => {
    // `aa` → `aaa`: the prefix takes both, the suffix must not take them again.
    expect(editSpan("aa", "aaa")).toEqual({ start: 2, end: 2, insert: "a" });
  });
});
