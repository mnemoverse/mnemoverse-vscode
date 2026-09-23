import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findOnPath } from "./preflight";

/** A fake file system: exactly these paths are executable. */
const fake = (paths: string[]) => (p: string) => paths.includes(p);

describe("findOnPath — POSIX", () => {
  it("returns the first executable match in PATH order", () => {
    const env = { PATH: "/usr/bin:/opt/node/bin:/usr/local/bin" };
    expect(findOnPath("npx", env, "darwin", fake(["/opt/node/bin/npx", "/usr/local/bin/npx"]))).toBe("/opt/node/bin/npx");
  });

  it("returns undefined when nothing matches, PATH is empty, or PATH is missing", () => {
    expect(findOnPath("npx", { PATH: "/usr/bin" }, "linux", fake([]))).toBeUndefined();
    expect(findOnPath("npx", { PATH: "" }, "linux", fake(["/npx"]))).toBeUndefined();
    expect(findOnPath("npx", {}, "linux", fake(["/usr/bin/npx"]))).toBeUndefined();
  });

  it("does not read `Path` on POSIX (case-sensitive env)", () => {
    expect(findOnPath("npx", { Path: "/usr/bin" }, "linux", fake(["/usr/bin/npx"]))).toBeUndefined();
  });

  it("does not apply PATHEXT on POSIX", () => {
    expect(findOnPath("npx", { PATH: "/bin", PATHEXT: ".CMD" }, "linux", fake(["/bin/npx.cmd"]))).toBeUndefined();
  });
});

describe("findOnPath — POSIX, real file system", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("finds an executable file and skips a non-executable one", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "pf-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "pf-b-"));
    dirs.push(a, b);
    fs.writeFileSync(path.join(a, "npx"), "not executable");
    fs.chmodSync(path.join(a, "npx"), 0o644);
    fs.writeFileSync(path.join(b, "npx"), "#!/bin/sh\n");
    fs.chmodSync(path.join(b, "npx"), 0o755);
    expect(findOnPath("npx", { PATH: `${a}:${b}` }, process.platform)).toBe(path.join(b, "npx"));
    expect(findOnPath("npx", { PATH: a }, process.platform)).toBeUndefined();
  });

  it.skipIf(process.platform === "win32")("skips a directory named like the command", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "pf-dir-"));
    dirs.push(a);
    fs.mkdirSync(path.join(a, "npx"));
    expect(findOnPath("npx", { PATH: a }, process.platform)).toBeUndefined();
  });
});

describe("findOnPath — win32 (PATH + PATHEXT)", () => {
  it("resolves npx to npx.cmd through PATHEXT, reading the `Path` spelling Windows uses", () => {
    const env = { Path: "C:\\Windows\\System32;C:\\Program Files\\nodejs", PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    expect(findOnPath("npx", env, "win32", fake(["C:\\Program Files\\nodejs\\npx.cmd"]))).toBe(
      "C:\\Program Files\\nodejs\\npx.cmd",
    );
  });

  it("strips quotes around PATH entries and ignores empty ones", () => {
    const env = { PATH: ';"C:\\Program Files\\nodejs";;', PATHEXT: ".CMD" };
    expect(findOnPath("npx", env, "win32", fake(["C:\\Program Files\\nodejs\\npx.cmd"]))).toBe(
      "C:\\Program Files\\nodejs\\npx.cmd",
    );
  });

  it("falls back to the default PATHEXT when the variable is missing", () => {
    expect(findOnPath("npx", { PATH: "C:\\node" }, "win32", fake(["C:\\node\\npx.cmd"]))).toBe("C:\\node\\npx.cmd");
  });

  it("tries PATHEXT in order (npx.exe before npx.cmd)", () => {
    const env = { PATH: "C:\\node", PATHEXT: ".EXE;.CMD" };
    expect(findOnPath("npx", env, "win32", fake(["C:\\node\\npx.exe", "C:\\node\\npx.cmd"]))).toBe("C:\\node\\npx.exe");
  });

  it("does not return an extensionless file Windows cannot run", () => {
    expect(findOnPath("npx", { PATH: "C:\\node", PATHEXT: ".CMD" }, "win32", fake(["C:\\node\\npx"]))).toBeUndefined();
  });

  it("accepts a command that already carries a PATHEXT extension", () => {
    expect(findOnPath("npx.cmd", { PATH: "C:\\node", PATHEXT: ".CMD" }, "win32", fake(["C:\\node\\npx.cmd"]))).toBe(
      "C:\\node\\npx.cmd",
    );
  });
});
