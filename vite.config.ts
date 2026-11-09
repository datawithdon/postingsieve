import { defineConfig } from "vitest/config";

// Used by Vitest. The extension itself is built by scripts/build.mjs.
export default defineConfig({ test: { include: ["tests/**/*.test.ts"], environment: "node" } });
