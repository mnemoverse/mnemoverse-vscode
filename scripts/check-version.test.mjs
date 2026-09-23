import { describe, it, expect } from "vitest";
import { checkVersion, hasVersionHeading, hasUnreleasedHeading, parseArgs } from "./check-version.mjs";

/** A consistent repo at `version`, with a changelog heading in this repo's format. */
function repo(version = "0.3.0", changelog = `# Changelog\n\n## [${version}] — 2026-10-01\n\n- x\n`) {
  return {
    pkg: { version },
    lock: { version, packages: { "": { version } } },
    changelog,
  };
}

describe("changelog headings", () => {
  it("matches the repo's `## [x.y.z] — date` format and the bare `## x.y.z` form", () => {
    expect(hasVersionHeading("## [0.2.1] — 2026-09-23\n", "0.2.1")).toBe(true);
    expect(hasVersionHeading("## 0.2.1\n", "0.2.1")).toBe(true);
    expect(hasVersionHeading("intro\n## [0.2.1]", "0.2.1")).toBe(true);
  });

  it("does not treat dots as wildcards or match a longer version", () => {
    expect(hasVersionHeading("## [0x2y1] — date\n", "0.2.1")).toBe(false);
    expect(hasVersionHeading("## [0.2.10] — date\n", "0.2.1")).toBe(false);
    expect(hasVersionHeading("### [0.2.1] — a sub-heading\n", "0.2.1")).toBe(false);
  });

  it("finds an Unreleased heading case-insensitively, with or without brackets", () => {
    expect(hasUnreleasedHeading("## [Unreleased]\n")).toBe(true);
    expect(hasUnreleasedHeading("## unreleased\n")).toBe(true);
    expect(hasUnreleasedHeading("Unreleased changes are listed below\n")).toBe(false);
  });
});

describe("checkVersion without a tag (PR CI)", () => {
  it("passes a consistent repo", () => {
    expect(checkVersion(repo("0.2.1")).errors).toEqual([]);
  });

  it("accepts an Unreleased heading so a PR can bump before the release date is known", () => {
    const r = checkVersion(repo("0.3.0", "## [Unreleased]\n\n## [0.2.1] — 2026-09-23\n"));
    expect(r.errors).toEqual([]);
  });

  it("fails when the changelog has neither heading", () => {
    const r = checkVersion(repo("0.3.0", "## [0.2.1] — 2026-09-23\n"));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/neither/);
  });

  it("reports both lockfile fields when they drift (the 0.1.1-vs-0.2.x case)", () => {
    const r = checkVersion({ ...repo("0.2.0"), lock: { version: "0.1.1", packages: { "": { version: "0.1.1" } } } });
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/root "version" is "0.1.1"/);
    expect(r.errors[1]).toMatch(/packages\[""\]\.version is "0.1.1"/);
  });

  it("rejects a semver pre-release suffix in package.json and stops there", () => {
    const r = checkVersion(repo("0.3.0-beta.1"));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/not plain X\.Y\.Z/);
  });

  it("rejects a missing version", () => {
    const r = checkVersion({ ...repo(), pkg: {} });
    expect(r.errors[0]).toMatch(/not plain X\.Y\.Z/);
  });
});

describe("checkVersion with a release tag", () => {
  it("vX.Y.Z is a stable release of X.Y.Z", () => {
    const r = checkVersion({ ...repo("0.4.0"), tag: "v0.4.0" });
    expect(r).toMatchObject({ version: "0.4.0", prerelease: false, errors: [], warnings: [] });
  });

  it("vX.Y.Z-pre is a pre-release of X.Y.Z", () => {
    const r = checkVersion({ ...repo("0.3.0"), tag: "v0.3.0-pre" });
    expect(r).toMatchObject({ version: "0.3.0", prerelease: true, errors: [], warnings: [] });
  });

  it("fails when the tag and package.json disagree (forgot to bump)", () => {
    const r = checkVersion({ ...repo("0.2.1"), tag: "v0.2.2" });
    expect(r.errors).toEqual([expect.stringMatching(/Tag v0\.2\.2 is for version 0\.2\.2.*says 0\.2\.1/)]);
  });

  it.each(["0.2.1", "v0.2", "v0.2.1-beta", "v0.2.1-pre.1", "v01.2.1", "v0.2.1 ", "refs/tags/v0.2.1"])(
    "rejects the non-release tag %j",
    (tag) => {
      const r = checkVersion({ ...repo("0.2.1"), tag });
      expect(r.errors).toEqual([expect.stringMatching(/is not a release tag/)]);
    },
  );

  it("requires the exact changelog heading; Unreleased is not enough to ship", () => {
    const r = checkVersion({ ...repo("0.4.0", "## [Unreleased]\n"), tag: "v0.4.0" });
    expect(r.errors).toEqual([expect.stringMatching(/no "## \[0\.4\.0\]" heading/)]);
  });

  it("refuses a stable tag for a version already shipped as a pre-release", () => {
    const r = checkVersion({ ...repo("0.3.0"), tag: "v0.3.0", existingTags: ["v0.2.1", "v0.3.0-pre"] });
    expect(r.errors).toEqual([expect.stringMatching(/v0\.3\.0-pre already exists/)]);
  });

  it("refuses a pre-release tag for a version already shipped as stable", () => {
    const r = checkVersion({ ...repo("0.2.1"), tag: "v0.2.1-pre", existingTags: ["v0.2.1"] });
    expect(r.errors).toEqual([expect.stringMatching(/v0\.2\.1 already exists/)]);
  });

  it("allows re-running the same tag (the tag itself is in the list)", () => {
    const r = checkVersion({ ...repo("0.4.0"), tag: "v0.4.0", existingTags: ["v0.4.0"] });
    expect(r.errors).toEqual([]);
  });

  it("warns, without failing, when the minor's parity goes against the odd/even convention", () => {
    const pre = checkVersion({ ...repo("0.2.2"), tag: "v0.2.2-pre" });
    expect(pre.errors).toEqual([]);
    expect(pre.warnings).toEqual([expect.stringMatching(/even minor/)]);

    const stable = checkVersion({ ...repo("0.3.1"), tag: "v0.3.1" });
    expect(stable.errors).toEqual([]);
    expect(stable.warnings).toEqual([expect.stringMatching(/odd minor/)]);
  });
});

describe("parseArgs", () => {
  it("reads --tag in both spellings", () => {
    expect(parseArgs([])).toEqual({});
    expect(parseArgs(["--tag", "v0.3.0-pre"])).toEqual({ tag: "v0.3.0-pre" });
    expect(parseArgs(["--tag=v0.4.0"])).toEqual({ tag: "v0.4.0" });
  });

  it("fails on an empty tag, so an unset workflow variable cannot skip the release checks", () => {
    expect(() => parseArgs(["--tag", ""])).toThrow(/needs a value/);
    expect(() => parseArgs(["--tag"])).toThrow(/needs a value/);
    expect(() => parseArgs(["--tag="])).toThrow(/needs a value/);
  });

  it("fails on unknown arguments", () => {
    expect(() => parseArgs(["--tga", "v0.4.0"])).toThrow(/Unknown argument/);
  });
});
