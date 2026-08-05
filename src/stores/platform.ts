import { create } from "zustand";
import { isTauri } from "@/api/anilist";

/**
 * Where Karasu is running, for the handful of screens whose honest answer
 * differs by platform.
 *
 * Read once at startup and cached: none of it can change while the app is
 * open. `null` until then, and every consumer guards on that rather than
 * assuming Windows — the wrong guess is what puts a Windows-only sentence in
 * front of a Linux user.
 */
export interface PlatformInfo {
  os: string;
  /** Running from an AppImage: the updater works and portable mode has a home. */
  appImage: boolean;
}

interface PlatformState {
  info: PlatformInfo | null;
  load: () => Promise<void>;
}

export const usePlatform = create<PlatformState>((set, get) => ({
  info: null,
  load: async () => {
    if (!isTauri || get().info) return;
    const { invoke } = await import("@tauri-apps/api/core");
    set({ info: await invoke<PlatformInfo>("platform_info") });
  },
}));

/** True only when we know it is Linux — never as a default. */
export const isLinux = (info: PlatformInfo | null) => info?.os === "linux";
