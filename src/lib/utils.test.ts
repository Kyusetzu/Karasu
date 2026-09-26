import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

/** The role tokens are this theme's own names, so the merge must know them or it drops one it mistakes for another. */
describe("cn", () => {
  it("keeps the 13 px step beside a text colour", () => {
    expect(cn("text-ui", "text-ink-100")).toBe("text-ui text-ink-100");
  });

  it("lets a later radius role replace an earlier one", () => {
    expect(cn("rounded-control", "rounded-panel")).toBe("rounded-panel");
    expect(cn("rounded-t-sheet", "rounded-t-none")).toBe("rounded-t-none");
  });

  it("treats the named shadows as shadows and the named layers as layers", () => {
    expect(cn("shadow-float", "shadow-sheet")).toBe("shadow-sheet");
    expect(cn("shadow-float", "shadow-accent-500")).toBe("shadow-float shadow-accent-500");
    expect(cn("z-popover", "z-alert")).toBe("z-alert");
  });

  it("keeps the eyebrow tracking beside a font size", () => {
    expect(cn("tracking-eyebrow", "text-2xs")).toBe("tracking-eyebrow text-2xs");
    expect(cn("tracking-wide", "tracking-eyebrow")).toBe("tracking-eyebrow");
  });
});
