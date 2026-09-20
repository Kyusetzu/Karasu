// The matchers are loaded by vitest.setup.ts, which sits outside tsconfig's `src`; this brings their types in.
import "@testing-library/jest-dom/vitest";
import type { AxeMatchers } from "vitest-axe";

// vitest-axe still augments the pre-1.0 `Vi` namespace, so the augmentation vitest 4 reads is written here.
declare module "vitest" {
  // oxlint-disable-next-line typescript/no-explicit-any
  interface Assertion<T = any> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
