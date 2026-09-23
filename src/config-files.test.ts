import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { MAX_CONFIG_BYTES, displayPath, findMnemoverseEntry, homeConfigFiles, readConfigFile } from "./config-files";

const ENTRY = JSON.stringify({ mcpServers: { mnemoverse: { url: "https://mcp.mnemoverse.com/mcp" } } });
const posixOnly = process.platform === "win32" ? it.skip : it;

let dir: string;
let savedHome: string | undefined;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mnemoverse-cfg-"));
  savedHome = process.env.HOME;
});
afterEach(() => {
  process.env.HOME = savedHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readConfigFile — bounded, read-only", () => {
  it("reads a small regular file", async () => {
    const f = path.join(dir, "mcp.json");
    fs.writeFileSync(f, ENTRY);
    expect(await readConfigFile(f)).toEqual({ ok: true, text: ENTRY });
  });

  it("reports a missing file as missing", async () => {
    expect(await readConfigFile(path.join(dir, "nope.json"))).toEqual({ ok: false, reason: "missing" });
    expect(await readConfigFile(path.join(dir, "nope", "mcp.json"), { fromWorkspace: true })).toEqual({ ok: false, reason: "missing" });
  });

  it("skips a file over the size limit without reading it", async () => {
    const f = path.join(dir, "big.json");
    fs.writeFileSync(f, " ".repeat(MAX_CONFIG_BYTES + 1));
    expect(await readConfigFile(f)).toEqual({ ok: false, reason: "too-large" });
  });

  it("skips a directory", async () => {
    expect(await readConfigFile(dir)).toEqual({ ok: false, reason: "not-a-file" });
  });

  posixOnly("never follows a symlink in a workspace file (git can store one pointing at /dev/zero)", async () => {
    const link = path.join(dir, "mcp.json");
    fs.symlinkSync("/dev/zero", link);
    expect(await readConfigFile(link, { fromWorkspace: true })).toEqual({ ok: false, reason: "symlink" });
  });

  posixOnly("follows a symlink in a home file (dotfile managers) but still refuses a device", async () => {
    const real = path.join(dir, "real.json");
    fs.writeFileSync(real, ENTRY);
    const good = path.join(dir, "good.json");
    fs.symlinkSync(real, good);
    expect(await readConfigFile(good)).toEqual({ ok: true, text: ENTRY });

    const dev = path.join(dir, "dev.json");
    fs.symlinkSync("/dev/zero", dev);
    expect(await readConfigFile(dev)).toEqual({ ok: false, reason: "not-a-file" });
  });

  posixOnly("does not block on a FIFO", async () => {
    const fifo = path.join(dir, "mcp.json");
    execFileSync("mkfifo", [fifo]);
    const result = await Promise.race([
      readConfigFile(fifo),
      new Promise((r) => setTimeout(() => r("hung"), 2000)),
    ]);
    expect(result).toEqual({ ok: false, reason: "not-a-file" });
  });
});

describe("findMnemoverseEntry", () => {
  it("returns the first file with an entry, and reports skipped files except missing ones", async () => {
    const big = path.join(dir, "big.json");
    fs.writeFileSync(big, " ".repeat(MAX_CONFIG_BYTES + 1));
    const good = path.join(dir, "good.json");
    fs.writeFileSync(good, ENTRY);
    const skipped: string[] = [];
    const found = await findMnemoverseEntry(
      [{ file: path.join(dir, "missing.json") }, { file: big }, { file: good }],
      (file, reason) => skipped.push(`${path.basename(file)}:${reason}`),
    );
    expect(found).toEqual({ file: good, server: "mnemoverse" });
    expect(skipped).toEqual(["big.json:too-large"]);
  });

  it("returns undefined when no file has an entry", async () => {
    const f = path.join(dir, "other.json");
    fs.writeFileSync(f, JSON.stringify({ mcpServers: { gh: { url: "https://api.githubcopilot.com/mcp" } } }));
    expect(await findMnemoverseEntry([{ file: f }])).toBeUndefined();
    expect(await findMnemoverseEntry([])).toBeUndefined();
  });
});

describe("home paths", () => {
  it("resolves home-relative paths and shows them with ~", () => {
    process.env.HOME = dir;
    const [ref] = homeConfigFiles([".kiro/settings/mcp.json"]);
    expect(ref.file).toBe(path.join(dir, ".kiro", "settings", "mcp.json"));
    expect(displayPath(ref.file)).toBe("~/.kiro/settings/mcp.json");
    expect(displayPath("/elsewhere/mcp.json")).toBe("/elsewhere/mcp.json");
    expect(homeConfigFiles(undefined)).toEqual([]);
  });
});
