// @ts-check
/**
 * Package-contents gate: asserts what `vsce ls` says will go into the .vsix.
 * Run it after `npm run compile` (so out/ exists) as `npm run check:package`.
 * CI runs it on every PR and the release build runs it before `vsce package`.
 *
 * Why this exists: the .vsix is assembled from .vscodeignore, a deny-list.
 * Any new top-level file or folder ships to every user unless someone
 * remembers to add it there, and nothing fails when they forget. Two ways
 * that goes wrong for this extension:
 *   - Too much: TypeScript sources, tests, source maps, repo tooling
 *     (scripts/, docs/, .github/) or a stray .env/.vsix end up in a public
 *     download. The extension has no runtime dependencies, so node_modules/
 *     in the package is always a mistake.
 *   - Too little: an over-broad ignore pattern drops out/extension.js (the
 *     `main` entry) or the icon, and the store accepts a package that cannot
 *     activate.
 *
 * `vsce ls` is the same file walk `vsce package` performs, so checking its
 * output checks the real package without building one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Paths that must never be packaged, with the reason shown on failure.
 * Paths are relative to the extension root with forward slashes, as
 * `vsce ls` prints them.
 *
 * @type {ReadonlyArray<{ pattern: RegExp, reason: string }>}
 */
export const FORBIDDEN = [
  { pattern: /^src\//, reason: "TypeScript sources (only compiled out/*.js ships)" },
  { pattern: /(^|\/)node_modules\//, reason: "node_modules (the extension has no runtime dependencies)" },
  { pattern: /\.test\.[cm]?js$/, reason: "compiled test file" },
  { pattern: /\.map$/, reason: "source map" },
  { pattern: /\.[cm]?ts$/, reason: "TypeScript file" },
  { pattern: /^(scripts|docs|\.github|\.vscode)\//, reason: "repository tooling or docs" },
  { pattern: /(^|\/)\.env(\.|$)/, reason: "environment file" },
  { pattern: /\.vsix$/, reason: "a previously built .vsix" },
];

/**
 * Files the package must contain: the manifest, the store page sources, the
 * license, and whatever package.json names as `main` and `icon`.
 *
 * @param {{ main?: unknown, icon?: unknown }} pkg parsed package.json
 * @returns {string[]}
 */
export function requiredFiles(pkg) {
  /** @param {unknown} p */
  const norm = (p) => (typeof p === "string" ? p.replace(/^\.\//, "") : undefined);
  const main = norm(pkg.main);
  const icon = norm(pkg.icon);
  /** @type {string[]} */
  const files = ["package.json", "README.md", "CHANGELOG.md", "LICENSE"];
  // `main` may omit the extension ("./out/extension"); Node resolves .js.
  if (main) files.push(main.endsWith(".js") ? main : `${main}.js`);
  if (icon) files.push(icon);
  return files;
}

/**
 * Pure core: compare a `vsce ls` listing against the rules above.
 *
 * @param {string[]} files  paths as printed by `vsce ls`
 * @param {{ main?: unknown, icon?: unknown }} pkg parsed package.json
 * @returns {string[]} errors; empty means the package is fine
 */
export function checkPackageFiles(files, pkg) {
  /** @type {string[]} */
  const errors = [];
  const listed = new Set(files);
  for (const file of files) {
    const hit = FORBIDDEN.find((f) => f.pattern.test(file));
    if (hit) errors.push(`${file} would be packaged (${hit.reason}). Add it to .vscodeignore.`);
  }
  for (const file of requiredFiles(pkg)) {
    if (!listed.has(file)) {
      errors.push(`${file} is missing from the package. Run \`npm run compile\` first, or check .vscodeignore.`);
    }
  }
  return errors;
}

/** @param {string} stdout */
export function parseListing(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const onActions = process.env.GITHUB_ACTIONS === "true";
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

  // `npx --no` uses the locked devDependency and refuses to download one.
  // Windows needs a shell to find npx.cmd.
  const stdout = execFileSync("npx", ["--no", "vsce", "ls"], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const files = parseListing(stdout);
  const errors = checkPackageFiles(files, pkg);

  console.log(`vsce ls: ${files.length} files`);
  for (const f of files) console.log(`  ${f}`);
  for (const e of errors) console.log(onActions ? `::error::${e}` : `error: ${e}`);
  if (errors.length > 0) process.exitCode = 1;
}

// Run only when executed directly, not when imported by the unit tests.
// realpath on both sides: import.meta.url is already symlink-resolved, argv[1]
// is not (macOS /tmp -> /private/tmp would otherwise skip main silently).
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
