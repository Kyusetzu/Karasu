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
      "@": path.resolve(import.meta.dirname, "src"),
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

  /**
   * Two test projects, split by an explicit `.dom.` in the filename.
   *
   * Everything is **node** by default, which is what keeps the suite fast —
   * thirty-odd files and four hundred assertions in about two seconds. Only
   * `*.dom.test.tsx` boots jsdom and Testing Library.
   *
   * The marker is in the name rather than inferred from the extension, because
   * inferring it is wrong: `components/stats/Charts.test.tsx` renders with
   * `renderToStaticMarkup` and its own comment says it needs no DOM and no
   * testing library. An extension rule dragged it into jsdom for nothing. A test
   * needing a DOM is a deliberate choice, so it says so in its filename.
   */
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.dom.test.tsx"],
          environment: "node",
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/*.dom.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          // A jsdom test on a cold CI runner can spend most of vitest's 5 s
          // default just rendering: run 33788735270 saw a plain `waitFor` in
          // SyncPanel.dom.test.tsx time out on a runner that reported 47 s of
          // transforms, on a branch that changed only a workflow file. Twenty
          // seconds still fails a real hang; it stops failing a slow machine.
          testTimeout: 20_000,
        },
      },
    ],
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
