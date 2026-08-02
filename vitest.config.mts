import { defineConfig } from "vitest/config";
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
  resolve: {
    alias: {
      "@": path.resolve(here, "."),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    reporters: "default",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/server/**/*.ts"],
    },
  },
});
