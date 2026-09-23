import { defineConfig } from "vitest/config";

// .mts, not .ts: package.json has no "type": "module", so Vite 8 (vitest 4)
// warns that an ESM-syntax vitest.config.ts is loaded as CommonJS and that
// this stops working once its native config loader becomes the default.
export default defineConfig({
  test: {
    environment: "node",
    // src/: the extension's unit tests. scripts/: the CI gates
    // (check-version, check-package), tested so a release cannot be
    // blocked or waved through by a regex mistake.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
