import { describe, it, expect } from "vitest";
import { checkPackageFiles, parseListing, requiredFiles } from "./check-package.mjs";

const pkg = { main: "./out/extension.js", icon: "icon.png" };

/** The v0.2.1 package as `vsce ls` listed it. */
const GOOD = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "icon.png",
  "package.json",
  "out/auth.js",
  "out/extension.js",
  "out/prompts.js",
  "out/provider.js",
  "out/session.js",
  "out/signin-core.js",
  "out/signin.js",
];

describe("checkPackageFiles", () => {
  it("passes the v0.2.1 file list", () => {
    expect(checkPackageFiles(GOOD, pkg)).toEqual([]);
  });

  it.each([
    ["src/extension.ts", /TypeScript sources/],
    ["node_modules/foo/index.js", /node_modules/],
    ["out/session.test.js", /compiled test file/],
    ["out/extension.js.map", /source map/],
    ["vitest.config.mts", /TypeScript file/],
    ["scripts/check-version.mjs", /tooling or docs/],
    ["docs/RELEASING.md", /tooling or docs/],
    [".github/workflows/ci.yml", /tooling or docs/],
    [".env", /environment file/],
    [".env.local", /environment file/],
    ["mnemoverse-vscode-0.2.1.vsix", /\.vsix/],
  ])("rejects %s", (file, reason) => {
    const errors = checkPackageFiles([...GOOD, file], pkg);
    expect(errors).toEqual([expect.stringMatching(reason)]);
  });

  it("does not flag look-alikes that are fine to ship", () => {
    expect(checkPackageFiles([...GOOD, "out/environment.js", "media/docs.png"], pkg)).toEqual([]);
  });

  it("fails when the entry point is missing (compile not run, or ignored by mistake)", () => {
    const errors = checkPackageFiles(GOOD.filter((f) => f !== "out/extension.js"), pkg);
    expect(errors).toEqual([expect.stringMatching(/out\/extension\.js is missing/)]);
  });

  it("fails on an empty listing, e.g. when `vsce ls` printed nothing", () => {
    expect(checkPackageFiles([], pkg).length).toBe(requiredFiles(pkg).length);
  });
});

describe("requiredFiles", () => {
  it("normalises ./ and a main without an extension", () => {
    expect(requiredFiles({ main: "./out/extension", icon: "./icon.png" })).toEqual([
      "package.json",
      "README.md",
      "CHANGELOG.md",
      "LICENSE",
      "out/extension.js",
      "icon.png",
    ]);
  });
});

describe("parseListing", () => {
  it("splits lines, trims, drops blanks and normalises Windows separators", () => {
    expect(parseListing("package.json\r\nout\\extension.js\n\n  README.md  \n")).toEqual([
      "package.json",
      "out/extension.js",
      "README.md",
    ]);
  });
});
