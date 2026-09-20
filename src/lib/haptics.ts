import { selectionFeedback } from "@tauri-apps/plugin-haptics";
import { isTauri } from "@/api/anilist";
import { isAndroid, usePlatform } from "@/stores/platform";

/** The one tick a gesture gets when it lands — the sheet opening, the pull arming — and nothing off Android. */
export function tick(): void {
  if (!isTauri || !isAndroid(usePlatform.getState().info)) return;
  void selectionFeedback().catch(() => {});
}
