/** Chunked because spreading every byte into `String.fromCharCode` overflows the call stack on large exports. */
const CHUNK = 0x8000;

/** Bytes to base64 for a Tauri command, since Tauri JSON-serializes a typed array as an array of numbers. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(
      ...(bytes.subarray(i, i + CHUNK) as unknown as number[]),
    );
  }
  return btoa(binary);
}
