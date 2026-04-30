import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Keep Playwright e2e tests out of Vitest's run
    exclude: ["**/node_modules/**", "**/.next/**", "e2e/**"],
    css: false,
  },
});
