import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LineChart, RadarChart, Sunburst, Treemap } from "./Charts";

/**
 * These charts kept their numbers in `<title>` elements, which is to say behind
 * a hover — invisible on a screenshot, unreachable on a touchscreen and absent
 * from the page for anyone reading it rather than pointing at it.
 *
 * Rendering to static markup is enough to check that: it needs no DOM and no
 * testing library, and the question is only whether the figure is in the output
 * at all. Where a value is deliberately dropped — a slice too thin to write in
 * — the test says so, so that thinning stays a decision rather than a
 * regression nobody notices.
 */
const html = (node: React.ReactElement) => renderToStaticMarkup(node);

/** Text content only, so a value cannot be "found" inside a path's geometry. */
function texts(markup: string): string[] {
  return [...markup.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
}

describe("LineChart", () => {
  const data = [
    { label: "2021", value: 42 },
    { label: "2022", value: 17 },
    { label: "2023", value: 88 },
  ];

  it("writes every point's value and every label", () => {
    const out = texts(html(<LineChart data={data} />));
    for (const d of data) {
      expect(out).toContain(String(d.value));
      expect(out).toContain(d.label);
    }
  });

  it("scales to its container instead of being pinned to a pixel height", () => {
    const markup = html(<LineChart data={data} />);
    expect(markup).toContain('class="w-full"');
    // A fixed height plus a narrower viewBox is what letterboxed these.
    expect(markup).not.toMatch(/style="[^"]*height/);
    expect(markup).not.toContain('preserveAspectRatio="none"');
  });
});

describe("Treemap", () => {
  const data = [
    { label: "Male Protagonist", value: 353 },
    { label: "Heterosexual", value: 163 },
    { label: "School", value: 134 },
    { label: "Isekai", value: 105 },
  ];

  it("fills the width it is given rather than sitting in the middle of it", () => {
    const markup = html(<Treemap data={data} />);
    // The bug: viewBox 320x180 drawn into a ~1000px card meant `xMidYMid meet`
    // scaled it 1:1 and centred it, leaving two thirds of the card empty.
    expect(markup).toMatch(/viewBox="0 0 1000 300"/);
    expect(markup).not.toMatch(/style="[^"]*height/);
  });

  it("labels every tile it has room for, and numbers the rest", () => {
    const out = texts(html(<Treemap data={data} />));
    for (const d of data) {
      expect(out).toContain(String(d.value));
    }
    expect(out.some((t) => t.startsWith("Male Protagonist"))).toBe(true);
  });

  it("drops a value only when the tile is too small to hold one", () => {
    // One dominant tile and a sliver: the sliver is what thinning is for.
    const out = texts(html(<Treemap data={[
      { label: "Huge", value: 5000 },
      { label: "Sliver", value: 1 },
    ]} />));
    expect(out).toContain("5000");
    expect(out).not.toContain("Sliver");
  });
});

describe("RadarChart", () => {
  const axes = [
    { label: "Action", value: 120 },
    { label: "Fantasy", value: 90 },
    { label: "Comedy", value: 60 },
    { label: "Drama", value: 45 },
  ];

  it("writes each axis's count next to its label", () => {
    const out = texts(html(<RadarChart axes={axes} />));
    for (const a of axes) {
      expect(out).toContain(a.label);
      expect(out).toContain(String(a.value));
    }
  });

  it("labels the rings, so the polygon is a measurement and not just a shape", () => {
    const out = texts(html(<RadarChart axes={axes} />));
    expect(out).toContain("120"); // the outer ring == the largest axis
    expect(out).toContain("60"); // the half ring
  });
});

describe("Sunburst", () => {
  const data = [
    {
      label: "Completed",
      value: 376,
      children: [
        { label: "TV", value: 300 },
        { label: "MOVIE", value: 76 },
      ],
    },
    { label: "Planning", value: 98, children: [{ label: "TV", value: 98 }] },
  ];

  it("writes the totals into the rings that are wide enough", () => {
    const out = texts(html(<Sunburst data={data} />));
    expect(out).toContain("474"); // the centre total
    expect(out).toContain("376");
    expect(out).toContain("300");
  });

  it("leaves a sliver unlabelled rather than overprinting it", () => {
    const out = texts(
      html(
        <Sunburst
          data={[
            { label: "Nearly all", value: 1000 },
            { label: "A sliver", value: 1 },
          ]}
        />,
      ),
    );
    expect(out).toContain("1000");
    // 1 of 1001 is a third of a degree; there is nowhere to put the number.
    expect(out.filter((t) => t === "1")).toHaveLength(0);
  });
});
