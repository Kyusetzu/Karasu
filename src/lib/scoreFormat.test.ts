import { describe, expect, it } from "vitest";
import {
  asScoreFormat,
  formatMeanScore,
  formatScore,
  fromRaw,
  SCORE_FORMATS,
  scoreOptions,
  scoreScale,
  toRaw,
  type ScoreFormat,
} from "./scoreFormat";

describe("formatMeanScore", () => {
  it("always keeps one decimal — a mean of integers is not an integer", () => {
    expect(formatMeanScore("POINT_10", 7.06)).toBe("7.1");
    expect(formatMeanScore("POINT_100", 82.36)).toBe("82.4");
    expect(formatMeanScore("POINT_5", 4)).toBe("4.0");
  });

  it("stays numeric even on the smiley scale, and clamps to the max", () => {
    expect(formatMeanScore("POINT_3", 2.4)).toBe("2.4");
    expect(formatMeanScore("POINT_10", 11)).toBe("10.0");
  });

  it("nothing scored is an en dash", () => {
    expect(formatMeanScore("POINT_10", 0)).toBe("–");
    expect(formatMeanScore("POINT_10", NaN)).toBe("–");
  });
});

describe("toRaw", () => {
  it("maps each format onto the hundred-point raw scale", () => {
    expect(toRaw("POINT_100", 85)).toBe(85);
    expect(toRaw("POINT_10_DECIMAL", 8.5)).toBe(85);
    expect(toRaw("POINT_10", 8)).toBe(80);
    expect(toRaw("POINT_5", 4)).toBe(80);
  });

  it("uses AniList's own 35/60/85 mapping for the smiley scale", () => {
    // The site writes these exact raw values; inventing 33/66/100 would make
    // Karasu's smileys disagree with anilist.co's.
    expect(toRaw("POINT_3", 1)).toBe(35);
    expect(toRaw("POINT_3", 2)).toBe(60);
    expect(toRaw("POINT_3", 3)).toBe(85);
  });

  it("zero means unscored and stays zero in every format", () => {
    for (const f of SCORE_FORMATS) {
      expect(toRaw(f, 0), f).toBe(0);
    }
  });

  it("clamps past the scale instead of writing an impossible raw", () => {
    expect(toRaw("POINT_10", 15)).toBe(100);
    expect(toRaw("POINT_5", 9)).toBe(100);
    expect(toRaw("POINT_100", 150)).toBe(100);
    expect(toRaw("POINT_10", -3)).toBe(0);
    expect(toRaw("POINT_10", NaN)).toBe(0);
  });
});

describe("fromRaw", () => {
  it("inverts toRaw for every scoreable value of every format", () => {
    const values: Record<ScoreFormat, number[]> = {
      POINT_100: [1, 35, 50, 85, 100],
      POINT_10_DECIMAL: [0.5, 3.5, 8.5, 10],
      POINT_10: [1, 5, 8, 10],
      POINT_5: [1, 3, 5],
      POINT_3: [1, 2, 3],
    };
    for (const f of SCORE_FORMATS) {
      for (const v of values[f]) {
        expect(fromRaw(f, toRaw(f, v)), `${f} ${v}`).toBe(v);
      }
    }
  });

  it("buckets raw values onto the smiley thresholds", () => {
    expect(fromRaw("POINT_3", 20)).toBe(1);
    expect(fromRaw("POINT_3", 35)).toBe(1);
    expect(fromRaw("POINT_3", 36)).toBe(2);
    expect(fromRaw("POINT_3", 60)).toBe(2);
    expect(fromRaw("POINT_3", 61)).toBe(3);
    expect(fromRaw("POINT_3", 100)).toBe(3);
  });

  it("zero and junk read as unscored", () => {
    for (const f of SCORE_FORMATS) {
      expect(fromRaw(f, 0), f).toBe(0);
      expect(fromRaw(f, NaN), f).toBe(0);
    }
  });
});

describe("formatScore", () => {
  it("renders in the format's own precision", () => {
    expect(formatScore("POINT_100", 85)).toBe("85");
    expect(formatScore("POINT_10_DECIMAL", 8.5)).toBe("8.5");
    expect(formatScore("POINT_10_DECIMAL", 8)).toBe("8.0");
    expect(formatScore("POINT_10", 8)).toBe("8");
    expect(formatScore("POINT_5", 4)).toBe("4");
  });

  it("the smiley scale renders smileys, not numbers", () => {
    expect(formatScore("POINT_3", 1)).toBe("☹️");
    expect(formatScore("POINT_3", 2)).toBe("😐");
    expect(formatScore("POINT_3", 3)).toBe("🙂");
  });

  it("unscored is an en dash, never a zero", () => {
    for (const f of SCORE_FORMATS) {
      expect(formatScore(f, 0), f).toBe("–");
    }
  });
});

describe("scoreScale / scoreOptions", () => {
  it("discrete formats enumerate their options; continuous ones do not", () => {
    expect(scoreOptions("POINT_10")).toHaveLength(10);
    expect(scoreOptions("POINT_5")).toEqual([1, 2, 3, 4, 5]);
    expect(scoreOptions("POINT_3")).toEqual([1, 2, 3]);
    expect(scoreOptions("POINT_100")).toBeNull();
    expect(scoreOptions("POINT_10_DECIMAL")).toBeNull();
  });

  it("steps and decimals agree with each other", () => {
    for (const f of SCORE_FORMATS) {
      const { step, decimals } = scoreScale(f);
      // A 0.1 step needs one decimal; whole steps need none.
      expect(decimals, f).toBe(step < 1 ? 1 : 0);
    }
  });
});

describe("asScoreFormat", () => {
  it("passes real formats through and defaults the rest to ten-point", () => {
    expect(asScoreFormat("POINT_5")).toBe("POINT_5");
    expect(asScoreFormat("POINT_100")).toBe("POINT_100");
    expect(asScoreFormat(null)).toBe("POINT_10");
    expect(asScoreFormat(undefined)).toBe("POINT_10");
    expect(asScoreFormat("SOMETHING_NEW")).toBe("POINT_10");
  });
});
