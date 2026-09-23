import { defineConfig } from "vitest/config";

// .mts, not .ts: package.json has no "type": "module", so Vite 8 (vitest 4)
// warns that an ESM-syntax vitest.config.ts is loaded as CommonJS and that
// this stops working once its native config loader becomes the default.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
