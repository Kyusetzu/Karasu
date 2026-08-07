/**
 * Bytes to base64, for handing binary to a Tauri command.
 *
 * Why not pass the bytes themselves: Tauri serializes a command's arguments
 * with `JSON.stringify`, and its replacer expands a typed array into a JSON
 * array of numbers. A 4 MB poster becomes ~16 MB of ASCII digits on the way out
 * and four million `serde_json` number parses on the way in. Base64 is ~1.37x
 * the bytes and a single decode.
 *
 * Chunked because `String.fromCharCode(...bytes)` spreads every byte as an
 * argument, and a few hundred thousand of those overflow the call stack — the
 * failure mode is a hard crash on exactly the large exports this exists for.
 */
const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + CHUNK) as unknown as number[]),
    );
  }
  return btoa(binary);
}
