/** Avatar fallback character: one code point, not a grapheme, so an emoji ZWJ sequence cannot overrun the disc. */
export function initialFor(name: string): string {
  const [first] = name.trim(); // The first code point, not `name[0]`, which would return half a surrogate pair.
  return first ? first.toUpperCase() : "?"; // Not `toLocaleUpperCase`, which reads the host locale.
}
