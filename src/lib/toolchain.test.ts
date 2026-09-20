import { describe, expect, it } from "vitest";

/** One Rust version everywhere: the file rustup reads and every CI step that installs a toolchain must agree. */

// Vite's glob rather than `node:fs` (no node types in the frontend tsconfig); the options must stay an inline literal.
const PIN_FILE = import.meta.glob("/rust-toolchain.toml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const WORKFLOWS = import.meta.glob("/.github/workflows/*.yml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const RECIPE = import.meta.glob("/packaging/fdroid/dev.kyu.karasu.yml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("the Rust toolchain pin", () => {
  const pin = /channel = "(\d+\.\d+\.\d+)"/.exec(PIN_FILE["/rust-toolchain.toml"] ?? "")?.[1];

  it("is an exact version, so a rebuild elsewhere compiles the same code", () => {
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("is the version every workflow installs", () => {
    expect(Object.keys(WORKFLOWS).length).toBeGreaterThan(5);
    for (const [file, text] of Object.entries(WORKFLOWS)) {
      const steps = text.split(/\n(?=\s*- (?:name|uses):)/).filter((s) => s.includes("dtolnay/rust-toolchain@"));
      for (const step of steps) {
        expect(step, `${file}: a rust-toolchain step without the pin`).toContain(`toolchain: ${pin}`);
      }
    }
  });

  it("is what the F-Droid recipe asks rustup for", () => {
    expect(RECIPE["/packaging/fdroid/dev.kyu.karasu.yml"]).toContain(`--default-toolchain ${pin}`);
  });
});
