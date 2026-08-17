import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const here = import.meta.dirname;

/**
 * Web test config — React render tests only.
 *
 * Every test here is a `.test.tsx` that opts into jsdom with a
 * `// @vitest-environment jsdom` docblock (see tests/trackViewRender.test.tsx).
 * The server-side suite moved to apps/api, which runs pure node with no
 * react plugin.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(here, "."),
      "@dropcheck/shared": path.resolve(here, "../../packages/shared/src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.tsx"],
    globals: false,
    reporters: "default",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["components/**/*.tsx", "lib/**/*.ts"],
    },
  },
});
