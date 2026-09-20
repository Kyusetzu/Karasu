import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { isTauri } from "@/api/anilist";

/** Puts text on the clipboard through Rust inside the app and through the browser outside it; false when neither could. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isTauri) await writeText(text);
    else await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
