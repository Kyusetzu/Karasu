import { axe } from "vitest-axe";
import type { RunOptions } from "axe-core";

/** axe under jsdom: no layout, so the two rules that need computed colour and geometry are off here, nowhere else. */
export const AXE_OPTIONS: RunOptions = {
  rules: {
    "color-contrast": { enabled: false },
    // A fragment rendered alone has no landmarks to be inside of; the page shell is graded separately.
    region: { enabled: false },
  },
};

export const checkA11y = (container: Element) => axe(container, AXE_OPTIONS);
