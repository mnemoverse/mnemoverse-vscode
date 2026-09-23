import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// .mts, not .ts: package.json has no "type": "module", so Vite 8 (vitest 4)
// warns that an ESM-syntax vitest.config.ts is loaded as CommonJS and that
// this stops working once its native config loader becomes the default.
export default defineConfig({
  resolve: {
    // The real `vscode` module exists only inside an editor's extension host.
    // Tests get a small stateful stand-in (test/vscode.mock.ts) instead.
    alias: [{ find: /^vscode$/, replacement: fileURLToPath(new URL("./test/vscode.mock.ts", import.meta.url)) }],
  },
  test: {
    environment: "node",
    // src/ and test/: the extension's unit and activation tests. scripts/:
    // the CI gates (check-version, check-package), tested so a release cannot
    // be blocked or waved through by a regex mistake.
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
