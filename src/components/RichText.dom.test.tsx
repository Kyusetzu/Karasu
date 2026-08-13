import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { RichText } from "./RichText";
import { parseAniListHtml } from "@/lib/anilistHtml";

/**
 * The description path, end to end: AniList's HTML in, elements out.
 *
 * `lib/anilistHtml.test.ts` proves the tree is clean. This proves the pair
 * together produce no markup — which is the claim that actually matters, since
 * the old code was a clean *string* handed to `dangerouslySetInnerHTML` and the
 * risk lived in that handoff rather than in either half.
 */

function description(html: string) {
  return render(
    <MemoryRouter>
      <RichText nodes={parseAniListHtml(html)} />
    </MemoryRouter>,
  );
}

const HOSTILE = [
  `<b onmouseover="alert(1)">hi</b>`,
  `<script>alert(1)</script>`,
  `<style>body{}</style>`,
  `<img src=x onerror=alert(1)>`,
  `<svg/onload=alert(1)>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<a href="javascript:alert(1)">x</a>`,
  `<div style="position:fixed;inset:0">overlay</div>`,
  `&lt;script&gt;alert(1)&lt;/script&gt;`,
  `<b><i>crossed</b></i>`,
  `<b>unclosed`,
  `</b>stray`,
];

describe("a description cannot become markup", () => {
  it("emits no dangerous element, for any input", () => {
    for (const src of HOSTILE) {
      const { container, unmount } = description(src);
      for (const tag of ["script", "style", "iframe", "img", "svg", "object", "embed"]) {
        expect(container.querySelectorAll(tag), `${tag} from ${src}`).toHaveLength(0);
      }
      unmount();
    }
  });

  it("emits no event handler and no inline style", () => {
    for (const src of HOSTILE) {
      const { container, unmount } = description(src);
      for (const el of container.querySelectorAll("*")) {
        for (const attr of el.getAttributeNames()) {
          expect(attr.toLowerCase().startsWith("on"), `${attr} from ${src}`).toBe(false);
        }
        expect(el.getAttribute("style"), src).toBeNull();
      }
      unmount();
    }
  });

  it("shows an escaped tag as text rather than reviving it", () => {
    const { container } = description(`&lt;script&gt;alert(1)&lt;/script&gt;`);
    expect(container.querySelectorAll("script")).toHaveLength(0);
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });
});

describe("a description keeps its formatting", () => {
  it("renders the five tags the old sanitizer allowed", () => {
    const { container } = description("<b>A</b> <i>B</i> <strong>C</strong> <em>D</em><br>E");
    expect(container.querySelectorAll("strong")).toHaveLength(2);
    expect(container.querySelectorAll("em")).toHaveLength(2);
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.textContent).toContain("E");
  });

  it("keeps the words from a tag it drops", () => {
    const { container } = description(`<div class=x><span>synopsis</span></div>`);
    expect(container.textContent).toBe("synopsis");
  });

  it("decodes entities into characters, not markup", () => {
    const { container } = description("Alice &amp; Bob &mdash; a story&hellip;");
    expect(container.textContent).toBe("Alice & Bob — a story…");
  });

  it("hides a spoiler behind a button instead of deleting it", () => {
    // The behaviour change from the sanitizer, which removed spoilers *and their
    // contents* — silently dropping part of the synopsis. Now the text is kept
    // but absent from the DOM until asked for.
    description("Kaneki ~!becomes a ghoul!~ eventually.");
    expect(screen.queryByText(/ghoul/)).toBeNull();
    expect(screen.getByRole("button").textContent).toContain("social.mdSpoiler");
    expect(document.body.textContent).toContain("eventually");
  });
});
