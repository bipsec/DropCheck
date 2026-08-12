import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const here = import.meta.dirname;

/**
 * Vitest config.
 *
 * - Node environment (all tests target server-side logic — the
 *   `lib/server/*` tree — not React components).
 * - `@/*` path alias mirrors tsconfig so imports look identical to
 *   the app code.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(here, "."),
    },
  },
  test: {
    environment: "node",
    // React-render tests use jsdom via a `// @vitest-environment jsdom`
    // docblock (see tests/trackViewRender.test.tsx). The rest of the
    // suite runs on the node env.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    globals: false,
    reporters: "default",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/server/**/*.ts"],
    },
  },
});
