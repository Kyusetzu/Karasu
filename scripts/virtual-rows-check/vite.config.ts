import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "../../src") } },
  server: { port: 5199, strictPort: true },
});
