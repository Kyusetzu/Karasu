import { describe, expect, it } from "vitest";
import { ENTITY_RE, decodeEntity } from "@/lib/htmlEntities";

describe("decodeEntity", () => {
  it("decodes the named table, decimal and hex references", () => {
    expect(decodeEntity("amp")).toBe("&");
    expect(decodeEntity("eacute")).toBe("é");
    expect(decodeEntity("#65")).toBe("A");
    expect(decodeEntity("#x41")).toBe("A");
    expect(decodeEntity("#X41")).toBe("A");
    expect(decodeEntity("#x1F600")).toBe("😀");
  });

  it("leaves a surrogate half, zero and anything past the last code point as literal text", () => {
    expect(decodeEntity("#xD800")).toBeNull();
    expect(decodeEntity("#xDFFF")).toBeNull();
    expect(decodeEntity("#0")).toBeNull();
    expect(decodeEntity("#x110000")).toBeNull();
    expect(decodeEntity("#xZZ")).toBeNull();
  });

  it("answers only the table's own names, never a plain object's inherited properties", () => {
    expect(decodeEntity("constructor")).toBeNull();
    expect(decodeEntity("__proto__")).toBeNull();
    expect(decodeEntity("hasOwnProperty")).toBeNull();
    expect(decodeEntity("nosuchentity")).toBeNull();
  });
});

describe("ENTITY_RE", () => {
  const at = (text: string, index: number) => {
    ENTITY_RE.lastIndex = index;
    return ENTITY_RE.exec(text)?.[1] ?? null;
  };

  it("matches only at the index it is asked about, so a bare ampersand in prose stays prose", () => {
    expect(at("AT&T", 2)).toBeNull();
    expect(at("a &amp; b", 2)).toBe("amp");
    expect(at("a &amp; b", 0)).toBeNull();
  });

  it("demands the semicolon and bounds the body", () => {
    expect(at("&amp b", 0)).toBeNull();
    expect(at("&#12345678;", 0)).toBeNull();
    expect(at("&#1234567;", 0)).toBe("#1234567");
    expect(at("&" + "a".repeat(33) + ";", 0)).toBeNull();
    expect(at("&" + "a".repeat(32) + ";", 0)).toBe("a".repeat(32));
  });
});
