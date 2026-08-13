import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RadarChart, Sunburst, Treemap } from "./Charts";
import { GradientBars } from "./GradientBars";
import { DotPlot } from "./DotPlot";
import { AreaChart } from "./AreaChart";
import { Heatmap } from "./Heatmap";

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

describe("AreaChart", () => {
  const data = [
    { label: "2021", value: 42 },
    { label: "2022", value: 17 },
    { label: "2023", value: 88 },
  ];

  it("writes every point's value and label, like the line it succeeds", () => {
    const out = texts(html(<AreaChart data={data} />));
    for (const d of data) {
      expect(out).toContain(String(d.value));
      expect(out).toContain(d.label);
    }
  });

  it("draws a curve, not a polyline, and keeps the theme's palette", () => {
    const markup = html(<AreaChart data={data} />);
    // curveMonotoneX emits cubic segments — a C in the path is the curve.
    expect(markup).toMatch(/<path[^>]*d="[^"]*C/);
    expect(markup).toContain("var(--color-accent-500)");
    expect(markup).toContain("rgba(var(--accent-rgb)");
    expect(markup).not.toMatch(/(?:fill|stroke)="#/);
  });

  it("normalizes the draw-on with pathLength, since a curve's length is not knowable in markup", () => {
    expect(html(<AreaChart data={data} />)).toContain('pathLength="1"');
  });

  it("declines a single point — one dot is not a series", () => {
    expect(html(<AreaChart data={[{ label: "2024", value: 3 }]} />)).toBe("");
  });
});

describe("Heatmap", () => {
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const years = [
    { year: 2023, months: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 5] },
    { year: 2024, months: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ];

  it("labels every year and month, and titles each busy cell with its count", () => {
    const markup = html(
      <Heatmap title="t" years={years} max={5} monthLabels={months} />,
    );
    expect(markup).toContain("2023");
    expect(markup).toContain("2024");
    expect(markup).toContain("M 2023 · 2");
    expect(markup).toContain("D 2023 · 5");
  });

  it("scales intensity through the accent variable, never a literal colour", () => {
    const markup = html(
      <Heatmap title="t" years={years} max={5} monthLabels={months} />,
    );
    expect(markup).toContain("rgba(var(--accent-rgb)");
    expect(markup).not.toMatch(/background:#/);
    // The busiest cell gets more alpha than the quietest.
    expect(markup).toContain("0.92");
    expect(markup).toContain("0.14");
  });

  it("an empty month keeps the surface tone — quiet, not missing", () => {
    const markup = html(
      <Heatmap title="t" years={years} max={5} monthLabels={months} />,
    );
    expect(markup).toContain("bg-surface-800");
  });

  it("renders nothing with no years", () => {
    expect(html(<Heatmap title="t" years={[]} max={0} monthLabels={months} />)).toBe("");
  });
});

describe("GradientBars", () => {
  const rows = [
    { label: "TV", value: 7.4, text: "7.4", sub: "120×" },
    { label: "Movie", value: 8.1, text: "8.1", sub: "14×" },
  ];

  it("writes every label, value and count in the flow of the page", () => {
    const markup = html(<GradientBars title="t" rows={rows} />);
    for (const r of rows) {
      expect(markup).toContain(r.label);
      expect(markup).toContain(r.text);
      expect(markup).toContain(r.sub);
    }
  });

  it("fills through a theme-following SVG gradient, never a literal colour", () => {
    const markup = html(<GradientBars title="t" rows={rows} />);
    expect(markup).toContain("<linearGradient");
    expect(markup).toContain("var(--color-accent-600)");
    expect(markup).toContain("var(--color-accent-400)");
    expect(markup).not.toMatch(/(?:fill|stop-color)="#/);
  });

  it("a pinned domain keeps a 7.4 from reading as a landslide over a 7.1", () => {
    // With domain 10, a 7.4 bar is 74 units wide — not the full 100 the
    // data-relative scale would give the longest row.
    const markup = html(
      <GradientBars title="t" domain={10} rows={[{ label: "TV", value: 7.4, text: "7.4" }]} />,
    );
    expect(markup).toContain('width="74"');
  });

  it("renders nothing for an empty list", () => {
    expect(html(<GradientBars title="t" rows={[]} />)).toBe("");
  });
});

describe("DotPlot", () => {
  const rows = [
    { label: "Hidden Gem", mine: 9.5, other: 6.2 },
    { label: "Overrated", mine: 4, other: 8.6 },
  ];

  it("writes each row's pair as text, not only as geometry", () => {
    const markup = html(
      <DotPlot title="t" rows={rows} legendMine="mine" legendOther="crowd" />,
    );
    expect(markup).toContain("Hidden Gem");
    expect(markup).toContain("6.2");
    expect(markup).toContain("9.5");
    expect(markup).toContain("mine");
    expect(markup).toContain("crowd");
  });

  it("keeps both dots on the theme's palette", () => {
    const markup = html(
      <DotPlot title="t" rows={rows} legendMine="m" legendOther="c" />,
    );
    expect(markup).toContain("var(--color-accent-400)");
    expect(markup).toContain("var(--color-graph-none)");
    expect(markup).not.toMatch(/fill="#/);
  });

  it("renders nothing for an empty list", () => {
    expect(html(<DotPlot title="t" rows={[]} legendMine="m" legendOther="c" />)).toBe("");
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
  // No axis is worth half the maximum. With one — the old fixture had 60
  // against a 120 maximum — the half-ring label is indistinguishable from that
  // axis's own count, and the ring test below passed with the rings deleted.
  const axes = [
    { label: "Action", value: 120 },
    { label: "Fantasy", value: 90 },
    { label: "Comedy", value: 70 },
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
    // The outer ring is the largest axis by definition, so no fixture makes it
    // a unique string — count it instead of asking whether it is present.
    expect(out.filter((v) => v === "120")).toHaveLength(2); // ring + axis
    expect(out).toContain("60"); // the half ring, which is nobody's count
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

  /**
   * `accent-ink` is derived to be readable *on the accent colour*. Only the
   * first two wedges are accent-filled; the rest are surface greys, where the
   * derivation is answering a different question and lands at 1.0–1.9:1 for
   * eleven of the eighteen accent/theme combinations. A value that renders
   * invisibly is still in the markup, so no `texts()` assertion can catch
   * this — the class is the only evidence.
   */
  it("writes each ring's count in an ink that its own fill can carry", () => {
    const markup = html(
      <Sunburst
        data={["Completed", "Current", "Paused", "Dropped", "Planning"].map(
          (label, i) => ({ label, value: 100 - i }),
        )}
      />,
    );
    const inks = [...markup.matchAll(/<text[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    const onAccent = inks.filter((c) => c.includes("fill-accent-ink"));
    expect(onAccent).toHaveLength(2); // TONES[0] and TONES[1], and no more
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
