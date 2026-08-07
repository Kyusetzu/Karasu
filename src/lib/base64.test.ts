import { describe, expect, it } from "vitest";
import { toBase64 } from "./base64";

describe("toBase64", () => {
  it("matches btoa for a small payload", () => {
    const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    expect(toBase64(bytes)).toBe("SGVsbG8=");
  });

  it("round-trips every byte value, padding included", () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) bytes[i] = i;
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (c) =>
      c.charCodeAt(0),
    );
    expect([...decoded]).toEqual([...bytes]);
  });

  it("handles a payload past the chunk boundary", () => {
    // Spreading this many arguments at once is what overflows the stack, and
    // a poster at 3x is an order of magnitude bigger again.
    const bytes = new Uint8Array(300_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const decoded = Uint8Array.from(atob(toBase64(bytes)), (c) =>
      c.charCodeAt(0),
    );
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[299_999]).toBe(bytes[299_999]);
  });
});
