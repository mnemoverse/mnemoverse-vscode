import { vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file lives in test/). */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Fresh module graph per test: the vscode mock and every extension module are
 * re-imported together, so module-level state (session guards, pending
 * sign-in, host state) never leaks between tests.
 */
export async function load() {
  vi.resetModules();
  const vscode = await import("./vscode.mock");
  const ext = await import("../src/extension");
  return { vscode, ext };
}

/** A temp dir, removed by the caller's afterEach via `cleanup`. */
export function tempDir(prefix = "mnemoverse-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** A PATH directory holding an executable `npx` (so the Node preflight passes). */
export function fakeNodeBin(): string {
  const dir = tempDir("mnemoverse-bin-");
  const npx = path.join(dir, "npx");
  fs.writeFileSync(npx, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(npx, 0o755);
  return dir;
}

/** Let fire-and-forget promises (first-run toasts, setContext) settle. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setImmediate(r));
  }
}

/** Command ids declared in package.json. */
export function manifestCommands(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return (pkg.contributes.commands as { command: string }[]).map((c) => c.command);
}

export function manifest(): any {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

/** Poll until `cond()` is true (async crypto etc. may take several ticks). */
export async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor: condition not met in time");
    }
    await new Promise((r) => setImmediate(r));
  }
}
