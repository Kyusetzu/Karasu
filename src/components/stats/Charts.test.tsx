import { describe, expect, it } from "vitest";
import { RadarChart, Sunburst, Treemap } from "./Charts";
import { html, texts } from "@/test/markup";

/** Static markup needs no DOM, so the filename stays without `.dom`; the tests ask only what the output holds. */

describe("Treemap", () => {
  const data = [
    { label: "Male Protagonist", value: 353 },
    { label: "Heterosexual", value: 163 },
    { label: "School", value: 134 },
    { label: "Isekai", value: 105 },
  ];

  it("fills the width it is given rather than sitting in the middle of it", () => {
    const markup = html(<Treemap data={data} />);
    // A pinned height under `xMidYMid meet` would centre the map and leave most of the card empty.
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
  // No axis may equal half the maximum, or the half-ring label doubles as that axis's own count.
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
    // The outer ring always equals the largest axis, so its string is counted rather than merely found.
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

  /** An invisible value is still in the markup, so the ink class is the only evidence. */
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
