import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Rooted at the repository so Tailwind scans the app exactly as the real build does.
export default defineConfig({
  root: path.resolve(__dirname, "../.."),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  server: { port: 5198, strictPort: true },
});
