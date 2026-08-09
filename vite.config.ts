import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  build: {
    // Karasu only ever runs in two engines, and neither is "whatever browser
    // matrix esbuild assumes by default" — so without this it emits downlevel
    // transforms and polyfills for engines that cannot run the app at all.
    //
    // The split is Tauri's own recommendation and it is not symmetric on
    // purpose: Windows is WebView2, i.e. evergreen Chromium, while Linux is
    // webkit2gtk-4.1, which lags well behind it. Targeting Chromium on both
    // would ship syntax WebKitGTK cannot parse, so Linux gets the conservative
    // Safari target and the platform decides.
    // @ts-expect-error process is a nodejs global
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
