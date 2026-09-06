import { describe, expect, it } from "vitest";
import { canTogglePin, donatorLabel, PIN_TIER, pinAbility } from "./donator";

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

describe("pinAbility", () => {
  it("is unknown for a viewer cached before the field existed", () => {
    expect(pinAbility({})).toBe("unknown");
    expect(pinAbility(null)).toBe("unknown");
    expect(pinAbility(undefined)).toBe("unknown");
  });

  it("reads null as no tier", () => {
    expect(pinAbility({ donatorTier: null })).toBe("no");
    expect(pinAbility({ donatorTier: 0 })).toBe("no");
  });

  it("needs the tier AniList asks for", () => {
    expect(pinAbility({ donatorTier: PIN_TIER - 1 })).toBe("no");
    expect(pinAbility({ donatorTier: PIN_TIER })).toBe("yes");
    expect(pinAbility({ donatorTier: 9 })).toBe("yes");
  });
});

describe("canTogglePin", () => {
  const unpinned = { isPinned: false };
  const pinned = { isPinned: true };

  it("is never offered on someone else's activity", () => {
    expect(canTogglePin({ donatorTier: 5 }, unpinned, false)).toBe(false);
    expect(canTogglePin({ donatorTier: 5 }, pinned, false)).toBe(false);
  });

  it("is hidden where AniList would refuse it", () => {
    expect(canTogglePin({ donatorTier: 0 }, unpinned, true)).toBe(false);
    expect(canTogglePin({ donatorTier: null }, unpinned, true)).toBe(false);
  });

  it("stays for a supporter and for an unknown tier", () => {
    expect(canTogglePin({ donatorTier: 2 }, unpinned, true)).toBe(true);
    expect(canTogglePin({}, unpinned, true)).toBe(true);
  });

  it("keeps the toggle on an already pinned activity whatever the tier", () => {
    expect(canTogglePin({ donatorTier: 0 }, pinned, true)).toBe(true);
  });
});
