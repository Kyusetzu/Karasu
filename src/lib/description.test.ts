import { describe, expect, it } from "vitest";
import { sanitizeDescription } from "./description";

describe("sanitizeDescription", () => {
  it("keeps the five tags it says it keeps", () => {
    const md = "<b>a</b><i>b</i><em>c</em><strong>d</strong>e<br>f";
    expect(sanitizeDescription(md)).toBe(md);
  });

  it("removes spoiler markers and everything between them", () => {
    expect(sanitizeDescription("safe ~!he dies!~ safe")).toBe("safe  safe");
  });

  /**
   * The bug this file exists for. The old test — had there been one — would
   * have asked whether `<script>` is removed, which it always was. The hole
   * was an attribute on a tag that *is* allowed.
   */
  it("strips attributes from the tags it keeps, not just the tags it drops", () => {
    expect(sanitizeDescription('<b onmouseover="alert(1)">hi</b>')).toBe("<b>hi</b>");
    expect(sanitizeDescription("<br onfocus=alert(1) autofocus>")).toBe("<br>");
    expect(sanitizeDescription('<B CLASS="x" STYLE="y">Y</B>')).toBe("<b>Y</b>");
  });

  it("drops anything that is not one of the five", () => {
    expect(sanitizeDescription("<img src=x onerror=alert(1)>")).toBe("");
    expect(sanitizeDescription("<script>alert(1)</script>hi")).toBe("alert(1)hi");
    expect(sanitizeDescription("<!-- comment -->text")).toBe("text");
    expect(sanitizeDescription("<a href='#'>link</a>")).toBe("link");
  });

  it("closes the tags it keeps", () => {
    expect(sanitizeDescription("<strong>a</strong>")).toBe("<strong>a</strong>");
    expect(sanitizeDescription("</b>")).toBe("</b>");
  });
});
