// @ts-check
/**
 * Version-consistency gate for CI (`ci.yml`) and the release pipeline
 * (`publish.yml`). Run it as `npm run check:version` or directly:
 *
 *   node scripts/check-version.mjs                   # PR / main CI
 *   node scripts/check-version.mjs --tag v0.3.0-pre  # release build
 *
 * Why this exists: the version lives in three places that nothing else keeps
 * in sync. `npm ci` never compares package-lock.json's root version with
 * package.json (the lock said 0.1.1 from v0.1.1 through v0.2.0 and every
 * install passed), and vsce happily packages a CHANGELOG that has no entry for
 * the version it ships. Checking all of it in one small script means PR CI and
 * the release job apply the same rules, and the rules have unit tests
 * (check-version.test.mjs).
 *
 * Checks, always:
 *   - package.json `version` is plain X.Y.Z. The VS Code Marketplace rejects
 *     semver pre-release suffixes; a pre-release is a flag on the upload
 *     (`--pre-release`), not part of the version string.
 *   - package-lock.json root `version` and `packages[""].version` both equal
 *     package.json `version`.
 *   - CHANGELOG.md has a `## [X.Y.Z]` heading for that version, or (without
 *     --tag only) an `## [Unreleased]` heading, so a PR can bump the version
 *     before the release date is known.
 *
 * Additionally with `--tag <tag>` (release builds):
 *   - The tag is `vX.Y.Z` (stable) or `vX.Y.Z-pre` (pre-release of X.Y.Z) and
 *     X.Y.Z equals package.json `version`.
 *   - CHANGELOG.md has the exact `## [X.Y.Z]` heading; "Unreleased" is not
 *     enough to ship.
 *   - The other flavour of the same version was never tagged. Both stores
 *     accept a given version number once, and `--skip-duplicate` turns the
 *     second upload into a silent success. Without this check, tagging v0.3.0
 *     after v0.3.0-pre would report "published" while every user stays on the
 *     pre-release build.
 *   - Warning only: Microsoft recommends odd minor versions for pre-releases
 *     and even minors for stable releases, because the stores always offer the
 *     highest version number. A mismatch is allowed but flagged.
 *
 * On GitHub Actions the result is also written to $GITHUB_OUTPUT as
 * `version=`, `prerelease=` and `tag=`, and problems are printed as
 * `::error::` / `::warning::` annotations.
 *
 * No dependencies beyond Node's standard library: this runs before anything
 * else in CI and must not be able to fail for reasons unrelated to versions.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Plain X.Y.Z with no leading zeros, per semver's core grammar. */
const SEMVER_CORE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** The only tag shapes the release pipeline accepts. Anything else fails. */
const RELEASE_TAG = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(-pre)?$/;

/**
 * @typedef {object} CheckInput
 * @property {{ version?: unknown }} pkg            parsed package.json
 * @property {{ version?: unknown, packages?: Record<string, { version?: unknown }> }} lock
 *                                                   parsed package-lock.json
 * @property {string} changelog                     CHANGELOG.md text
 * @property {string} [tag]                         release tag, when checking a release
 * @property {string[]} [existingTags]              every v* tag in the repository
 *
 * @typedef {object} CheckResult
 * @property {string} version       package.json version ("" when unreadable)
 * @property {boolean} prerelease   true when the tag ends in -pre
 * @property {string[]} errors      any entry means the check failed
 * @property {string[]} warnings    advisory only
 */

/**
 * Does the changelog have a second-level heading for `version`?
 * Accepts the repo's format `## [0.2.1] — 2026-09-23` and the bare
 * `## 0.2.1` some tools write. Escaping the dots matters: without it
 * `## [0.2.1]` would also satisfy a check for 0.201.
 *
 * @param {string} changelog
 * @param {string} version
 */
export function hasVersionHeading(changelog, version) {
  const v = version.replace(/\./g, "\\.");
  return new RegExp(`^##\\s+\\[?${v}\\]?(?:\\s|$)`, "m").test(changelog);
}

/** @param {string} changelog */
export function hasUnreleasedHeading(changelog) {
  return /^##\s+\[?unreleased\]?(?:\s|$)/im.test(changelog);
}

/**
 * Pure core of the gate: no file or git access, so every rule is testable.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkVersion({ pkg, lock, changelog, tag, existingTags = [] }) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  let prerelease = false;

  const version = typeof pkg.version === "string" ? pkg.version : "";
  if (!SEMVER_CORE.test(version)) {
    errors.push(
      `package.json version "${version}" is not plain X.Y.Z. The Marketplace does not accept ` +
        `semver pre-release suffixes; mark pre-releases with a vX.Y.Z-pre tag instead.`,
    );
    // Every later check compares against this value; stop here rather than
    // report a cascade of mismatches that all have the same cause.
    return { version, prerelease, errors, warnings };
  }

  if (lock.version !== version) {
    errors.push(
      `package-lock.json root "version" is "${String(lock.version)}", package.json is "${version}". ` +
        `Bump with \`npm version ${version} --no-git-tag-version\` (Node 24 / npm 11), which updates both.`,
    );
  }
  const rootPackage = lock.packages?.[""];
  if (rootPackage?.version !== version) {
    errors.push(
      `package-lock.json packages[""].version is "${String(rootPackage?.version)}", package.json is "${version}".`,
    );
  }

  const versionHeading = hasVersionHeading(changelog, version);

  if (tag === undefined) {
    if (!versionHeading && !hasUnreleasedHeading(changelog)) {
      errors.push(`CHANGELOG.md has neither a "## [${version}]" heading nor a "## [Unreleased]" heading.`);
    }
    return { version, prerelease, errors, warnings };
  }

  const match = RELEASE_TAG.exec(tag);
  if (!match) {
    errors.push(`Tag "${tag}" is not a release tag. Use vX.Y.Z for a stable release or vX.Y.Z-pre for a pre-release.`);
    return { version, prerelease, errors, warnings };
  }
  const tagVersion = match[1];
  prerelease = match[2] === "-pre";

  if (tagVersion !== version) {
    errors.push(`Tag ${tag} is for version ${tagVersion}, but package.json at that commit says ${version}.`);
  }
  if (!versionHeading) {
    errors.push(`CHANGELOG.md has no "## [${version}]" heading. Rename "Unreleased" to the version before tagging.`);
  }

  // The same version under the other flavour of tag was already released (or
  // at least tagged). See the header comment for why this is an error.
  const sibling = prerelease ? `v${tagVersion}` : `v${tagVersion}-pre`;
  if (existingTags.includes(sibling)) {
    errors.push(
      `Tag ${sibling} already exists for version ${tagVersion}. Each store accepts a version once, so ` +
        `${tag} would be skipped as a duplicate. Bump package.json to a new version instead.`,
    );
  }

  const minor = Number(tagVersion.split(".")[1]);
  if (prerelease && minor % 2 === 0) {
    warnings.push(
      `Pre-release ${tag} uses an even minor version. Microsoft recommends odd minors for pre-releases ` +
        `(e.g. 0.3.x) and even minors for stable releases (e.g. 0.4.x).`,
    );
  } else if (!prerelease && minor % 2 === 1) {
    warnings.push(
      `Stable release ${tag} uses an odd minor version, which by convention is the pre-release lane. ` +
        `Continue only if that is intended.`,
    );
  }

  return { version, prerelease, errors, warnings };
}

/**
 * Parse `--tag <value>` or `--tag=<value>`. Unknown arguments are an error so
 * that a typo in a workflow cannot silently skip the release checks.
 *
 * @param {string[]} argv
 * @returns {{ tag?: string }}
 */
export function parseArgs(argv) {
  /** @type {{ tag?: string }} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tag") {
      const value = argv[++i];
      if (value === undefined || value === "") throw new Error("--tag needs a value, e.g. --tag v0.3.0-pre");
      out.tag = value;
    } else if (arg.startsWith("--tag=")) {
      out.tag = arg.slice("--tag=".length);
      if (out.tag === "") throw new Error("--tag needs a value, e.g. --tag=v0.3.0-pre");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return out;
}

/** @param {string} repoRoot */
function listReleaseTags(repoRoot) {
  const out = execFileSync("git", ["tag", "--list", "v*"], { cwd: repoRoot, encoding: "utf8" });
  return out.split("\n").map((t) => t.trim()).filter(Boolean);
}

function main() {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const onActions = process.env.GITHUB_ACTIONS === "true";
  /** @param {string} path */
  const readJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), "utf8"));

  const { tag } = parseArgs(process.argv.slice(2));
  const result = checkVersion({
    pkg: readJson("package.json"),
    lock: readJson("package-lock.json"),
    changelog: readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8"),
    tag,
    // Only a release build needs the tag list; PR checkouts are often shallow
    // and carry no tags, so don't touch git there.
    existingTags: tag === undefined ? [] : listReleaseTags(repoRoot),
  });

  for (const w of result.warnings) console.log(onActions ? `::warning::${w}` : `warning: ${w}`);
  for (const e of result.errors) console.log(onActions ? `::error::${e}` : `error: ${e}`);

  if (result.errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  const kind = tag === undefined ? "" : result.prerelease ? " (pre-release)" : " (stable)";
  console.log(`version ${result.version}${tag === undefined ? "" : `, tag ${tag}`}${kind}: consistent`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\nprerelease=${result.prerelease}\ntag=${tag ?? ""}\n`,
    );
  }
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
