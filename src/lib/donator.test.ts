import { describe, expect, it } from "vitest";
import { donatorLabel } from "./donator";

describe("donatorLabel", () => {
  it("shows nothing at tier 0, however the badge reads", () => {
    // The regression this file exists for. Both of these are real accounts, and
    // both came back with the default label despite never having donated — so a
    // truthiness check on the badge badges essentially everyone.
    expect(donatorLabel({ donatorTier: 0, donatorBadge: "Donator" })).toBeNull();
    expect(donatorLabel({ donatorTier: 0, donatorBadge: "anything at all" })).toBeNull();
  });

  it("shows the custom label for a real supporter", () => {
    // Both observed on live accounts.
    expect(donatorLabel({ donatorTier: 3, donatorBadge: "Angel" })).toBe("Angel");
    expect(donatorLabel({ donatorTier: 4, donatorBadge: "kawoshin canon" })).toBe(
      "kawoshin canon",
    );
  });

  it("falls back to the default word rather than an empty chip", () => {
    expect(donatorLabel({ donatorTier: 1, donatorBadge: null })).toBe("Donator");
    expect(donatorLabel({ donatorTier: 1, donatorBadge: "   " })).toBe("Donator");
    expect(donatorLabel({ donatorTier: 1 })).toBe("Donator");
  });

  it("treats a missing or null tier as not a supporter", () => {
    expect(donatorLabel({})).toBeNull();
    expect(donatorLabel({ donatorTier: null, donatorBadge: "Donator" })).toBeNull();
  });

  it("does not trust a negative tier", () => {
    expect(donatorLabel({ donatorTier: -1, donatorBadge: "x" })).toBeNull();
  });
});
