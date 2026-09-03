import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Cloudflare plugin is deliberately absent: the tests cover the
// capability, tool-registration and workflow layers, which are plain
// browser code. The Worker is exercised end-to-end by `npm run dev`.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    globals: true,
    environment: "jsdom",
    css: false,
    include: ["src/**/*.spec.{ts,tsx}"],
  },
});
