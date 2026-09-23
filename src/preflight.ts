/**
 * Node.js preflight — pure, VS Code-free (unit-tested in node).
 *
 * The local connection launches the memory server as `npx -y
 * @mnemoverse/mcp-memory-server@latest`. If npx is not on the PATH the editor
 * spawns with, the failure surfaces late (after sign-in, at the first memory
 * call) and says nothing about the hosted alternative that needs no Node.js.
 * Looking npx up ourselves lets the extension say so BEFORE the user reaches
 * chat.
 *
 * VS Code spawns stdio MCP servers with the extension host's own environment
 * (`{ ...process.env }` in extHostMcpNode.ts), so resolving against
 * `process.env` here answers the same question the spawn will. On Windows it
 * resolves `npx` to `npx.cmd` through PATHEXT (findExecutable in
 * base/node/processes.ts); we mirror that, including the case-insensitive
 * `Path` variable name Windows actually uses.
 *
 * What this cannot catch: a Node older than the server's `engines` (>=18). A
 * PATH lookup finds the binary, not its version, and running `node -v` on every
 * resolve would add a process spawn to the hot path.
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Default PATHEXT when the variable is missing (the Windows default set, trimmed). */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Returns true when `p` is an existing file the current user may execute. */
export type IsExecutable = (p: string) => boolean;

/**
 * Default file check. On POSIX the execute bit matters (a non-executable
 * `npx` on PATH would still fail to spawn); on Windows executability is decided
 * by the extension, so existence of a regular file is enough.
 */
function defaultIsExecutable(platform: NodeJS.Platform): IsExecutable {
  return (p) => {
    try {
      if (!fs.statSync(p).isFile()) return false;
      if (platform !== "win32") fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
}

/** Read an env var case-insensitively (Windows stores PATH as `Path`). */
function getEnv(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== "win32") {
    return env[name];
  }
  const key = Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/**
 * Find `cmd` on the PATH in `env` the way the OS would, for `platform`.
 * Returns the full path of the first match, or `undefined`.
 *
 *   - POSIX: split PATH on ":", return the first `<dir>/<cmd>` that is an
 *     executable file.
 *   - win32: split PATH on ";", strip quotes around entries, and try
 *     `<dir>\<cmd><ext>` for every PATHEXT extension (case-insensitive). If `cmd`
 *     already ends in one of those extensions it is also tried as-is.
 *
 * `isExecutable` is injectable so tests can model either OS on any machine.
 */
export function findOnPath(
  cmd: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  isExecutable: IsExecutable = defaultIsExecutable(platform),
): string | undefined {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const pathVar = getEnv(env, "PATH", platform);
  if (!cmd || !pathVar) {
    return undefined;
  }
  const dirs = pathVar
    .split(win ? ";" : ":")
    .map((d) => (win ? d.trim().replace(/^"(.*)"$/, "$1") : d))
    .filter((d) => d.length > 0);

  let candidates: string[] = [cmd];
  if (win) {
    const exts = (getEnv(env, "PATHEXT", platform) || DEFAULT_PATHEXT)
      .split(";")
      .map((e) => e.trim())
      .filter((e) => e.length > 0);
    const hasKnownExt = exts.some((e) => cmd.toLowerCase().endsWith(e.toLowerCase()));
    candidates = [...(hasKnownExt ? [cmd] : []), ...exts.map((e) => cmd + e.toLowerCase())];
  }

  for (const dir of dirs) {
    for (const c of candidates) {
      const full = p.join(dir, c);
      if (isExecutable(full)) {
        return full;
      }
    }
  }
  return undefined;
}
