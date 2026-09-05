import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The site is a GitHub Pages *project* page, served under the repository's
// name — every asset URL and internal link has to carry the prefix, and the
// dev server mirrors it so a missing prefix is a bug you see locally.
export const BASE = "/Karasu/";

export default defineConfig(({ isSsrBuild }) => ({
  base: BASE,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    target: "es2022",
    modulePreload: { polyfill: false },
    // The mark stays a cacheable file rather than a data: URI in the HTML.
    assetsInlineLimit: 0,
    rollupOptions: isSsrBuild
      ? undefined
      : {
          output: {
            // `motion` in its own chunk: the hero is the only thing that needs
            // its sequencing engine, and it is loaded after first paint.
            manualChunks(id) {
              if (/node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/.test(id)) {
                return "motion";
              }
              return undefined;
            },
          },
        },
  },
  server: {
    // 1420 is the app's Vite port; the two dev servers must coexist.
    port: 4321,
    strictPort: true,
  },
  preview: { port: 4322, strictPort: true },
}));
