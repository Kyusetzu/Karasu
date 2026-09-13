import { create } from "zustand";
import { isTauri } from "@/api/anilist";

/** Where Karasu is running, read once at startup; `null` until then, and consumers guard on that rather than guess. */
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

/** True only when we know it is Android: the capability key, never the width key `usePhoneShell` answers. */
export const isAndroid = (info: PlatformInfo | null) => info?.os === "android";
