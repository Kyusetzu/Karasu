import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

/**
 * The renderer's half of the parser's guarantee.
 *
 * `lib/anilistMarkdown.test.ts` proves the *tree* cannot carry executable
 * content. This proves the *component* does not reintroduce it — the tree being
 * safe is worth nothing if the thing drawing it reaches for innerHTML, and those
 * are two separate claims that need two separate tests.
 */

function draw(source: string) {
  return render(
    <MemoryRouter>
      <Markdown source={source} />
    </MemoryRouter>,
  );
}

const HOSTILE = [
  `<script>alert(1)</script>`,
  `<b onmouseover=alert(1)>hi</b>`,
  `<img src=x onerror=alert(1)>`,
  `<div style="background:url(//evil)">art</div>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `[click](javascript:alert(1))`,
  `[click](data:text/html;base64,PHNjcmlwdD4=)`,
  `[](jsonN4IgDglgdlCmAmIBcAWA7ADgMwFY0EYMAmAXyA==)`,
  `img(javascript:alert(1))`,
  `<svg/onload=alert(1)>`,
  `~!<script>alert(1)</script>!~`,
];

describe("Markdown renders no executable content", () => {
  /**
   * This used to assert **zero** `<img>` for any input, with a note saying that
   * if it ever failed, the no-CSP reasoning had to be revisited first. It has
   * been revisited, deliberately: bio images are fetched by Rust and handed back
   * as a `data:` URI, so the CSP is unchanged and the WebView still never talks
   * to imgur. See `commands/images.rs` and `components/RichText.tsx`.
   *
   * So the property that actually matters is now the one pinned here: **no
   * `<img>` may ever carry a remote `src`.** A `data:` URI is the proxy's own
   * output; anything with a scheme and a host would mean the page is fetching
   * for itself, which is exactly what was rejected.
   *
   * Under jsdom `isTauri` is false, so the proxy is never attempted and every
   * image falls back to the chip — which is also the shipped behaviour whenever
   * a fetch fails, and is what makes the loop below meaningful for HOSTILE.
   */
  it("never emits an img with a remote src, for any input", () => {
    for (const src of [...HOSTILE, `img(https://i.imgur.com/a.png)`, `![alt](https://i.imgur.com/a.png)`]) {
      const { container, unmount } = draw(src);
      for (const img of container.querySelectorAll("img")) {
        expect(img.getAttribute("src") ?? "", src).toMatch(/^data:/);
      }
      unmount();
    }
  });

  it("never emits a script, iframe, object or embed", () => {
    for (const src of HOSTILE) {
      const { container, unmount } = draw(src);
      for (const tag of ["script", "iframe", "object", "embed", "style", "svg"]) {
        expect(container.querySelectorAll(tag), `${tag} from ${src}`).toHaveLength(0);
      }
      unmount();
    }
  });

  it("never emits an element carrying an inline event handler or style", () => {
    for (const src of HOSTILE) {
      const { container, unmount } = draw(src);
      for (const el of container.querySelectorAll("*")) {
        for (const attr of el.getAttributeNames()) {
          expect(attr.toLowerCase().startsWith("on"), `${attr} on <${el.tagName}> from ${src}`).toBe(false);
        }
        // The parser drops every HTML attribute, so nothing should carry a style
        // it did not get from a Tailwind class.
        expect(el.getAttribute("style"), src).toBeNull();
      }
      unmount();
    }
  });

  it("gives every anchor an http, https or relative href", () => {
    for (const src of [...HOSTILE, `[ok](https://anilist.co)`, `see https://anilist.co`]) {
      const { container, unmount } = draw(src);
      for (const a of container.querySelectorAll("a")) {
        const href = a.getAttribute("href") ?? "";
        expect(
          /^https?:\/\//i.test(href) || href.startsWith("/"),
          `href "${href}" from ${src}`,
        ).toBe(true);
      }
      unmount();
    }
  });

  it("keeps the words when it drops the tag", () => {
    draw(`<div style="position:absolute"><span>tam</span> <b onmouseover=x>bold bit</b></div>`);
    expect(screen.getByText(/tam/)).toBeTruthy();
    expect(screen.getByText(/bold bit/)).toBeTruthy();
  });

  it("shows nothing at all for a script body", () => {
    const { container } = draw(`<script>alert(1)</script>`);
    expect(container.textContent).toBe("");
  });
});

describe("Markdown renders the real structures", () => {
  it("emits semantic elements for emphasis, code and quotes", () => {
    const { container } = draw("**b** *i* ~~s~~ `c`\n\n> quoted");
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("i");
    expect(container.querySelector("s")?.textContent).toBe("s");
    expect(container.querySelector("code")?.textContent).toBe("c");
    expect(container.querySelector("blockquote")?.textContent).toContain("quoted");
  });

  it("routes a mention through the router rather than off-site", () => {
    const { container } = draw("hi @kyu");
    const a = container.querySelector("a");
    // MemoryRouter renders a relative href, which is the proof it is internal.
    expect(a?.getAttribute("href")).toBe("/user/kyu");
  });

  it("renders an image as a button chip naming its host", () => {
    draw(`img(https://i.imgur.com/a.png)`);
    const chip = screen.getByRole("button");
    expect(chip.textContent).toContain("social.mdImage");
    expect(chip.textContent).toContain("i.imgur.com");
  });

  it("hides a spoiler behind a button until it is pressed", () => {
    draw(`~!the butler did it!~`);
    // The text must not be in the DOM at all — visually hiding it would still
    // leave it selectable and readable in the accessibility tree.
    expect(screen.queryByText(/butler/)).toBeNull();
    expect(screen.getByRole("button").textContent).toContain("social.mdSpoiler");
  });

  it("turns a single newline into a break, as bios rely on", () => {
    const { container } = draw("line one\nline two");
    expect(container.querySelectorAll("br")).toHaveLength(1);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("renders nothing for empty input rather than an empty box", () => {
    const { container } = draw("   ");
    expect(container.firstChild).toBeNull();
  });
});
