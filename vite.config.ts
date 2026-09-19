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
    // Linux's webkit2gtk lags behind Windows's evergreen WebView2; Safari 15 is the oldest with top-level await.
    // @ts-expect-error process is a nodejs global
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
  },

  /** Node by default; only a `.dom.` in the filename boots jsdom, because needing a DOM is a decision, not an inference. */
  test: {
    // Threads, not forks: nothing here needs a process of its own, and a worker thread starts in a fraction of the time.
    pool: "threads",
    // Failures as annotations on the PR's diff, where a red step alone would send the reader into the log.
    reporters: process.env.GITHUB_ACTIONS ? ["default", "github-actions"] : ["default"],
    // Reported in the summary, so a test that starts leaning on timers or the network shows up before it hurts.
    slowTestThreshold: 300,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["src/**/*.dom.test.tsx"],
          environment: "node",
          // Pure modules with no DOM to reset between files; sharing one module graph cuts the project to a quarter.
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          include: ["src/**/*.dom.test.tsx"],
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          // A cold CI runner can spend the default timeout just rendering a jsdom test; this still fails a real hang.
          testTimeout: 20_000,
        },
      },
    ],
  },

  // Tauri dev options: never clear the screen, or Vite obscures the rust errors.
  clearScreen: false,
  // tauri expects a fixed port, fail if that port is not available
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
      // tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
