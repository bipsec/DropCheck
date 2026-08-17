import { defineConfig } from "vitest/config";
import path from "node:path";

const here = import.meta.dirname;

/**
 * API test config — pure Node. No React plugin and no jsdom: every test
 * in this package targets the `lib/server/**` tree or a route handler,
 * so the browser-render tests live in apps/web instead.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(here, "."),
      "@dropcheck/shared": path.resolve(here, "../../packages/shared/src"),
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
      include: ["lib/server/**/*.ts", "src/**/*.ts"],
    },
  },
});
