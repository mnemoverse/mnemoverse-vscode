import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findMnemoverseServer } from "./hosts";

/**
 * Read-only lookups in other programs' MCP config files — VS Code-free, so it
 * unit-tests in node against real temp files, symlinks and FIFOs.
 *
 * Two callers: the Cursor adapter (is Mnemoverse already in ~/.cursor/mcp.json
 * or a workspace's .cursor/mcp.json? then don't register a second copy) and the
 * config-file editors (did the user already paste the snippet? then stop saying
 * "set up needed"). Nothing here ever writes.
 *
 * WHY THE CARE WHEN READING. A workspace file comes from whatever repository
 * the user opened, and git can store symlinks. A plain `fs.readFile` on
 * `<workspace>/.cursor/mcp.json` would:
 *
 *   - follow a symlink to /dev/zero and allocate hundreds of MB in the shared
 *     extension host before failing, on every activation in that workspace;
 *   - block forever on a FIFO (or any device that never returns), holding a
 *     libuv thread and leaving activate() waiting on the adapter.
 *
 * So each file is opened non-blocking, checked with fstat to be a regular file
 * no larger than MAX_CONFIG_BYTES, and read up to that size. Workspace files
 * additionally must not be symlinks. The user's own home files may be (dotfile
 * managers symlink them), but still pass the same regular-file and size checks.
 */

/** Hand-edited MCP configs are a few KB; anything this large is not one. */
export const MAX_CONFIG_BYTES = 256 * 1024;

/** A file to check, and whether it comes from an opened workspace (repo-controlled). */
export interface ConfigFileRef {
  file: string;
  fromWorkspace?: boolean;
}

/** Where an existing Mnemoverse entry was found. */
export interface FoundEntry {
  /** Absolute path of the file. */
  file: string;
  /** The entry's name inside `mcpServers` / `servers`. */
  server: string;
}

/** Why a file was not read. `missing` is normal and never logged by callers. */
export type SkipReason = "missing" | "symlink" | "not-a-file" | "too-large" | "unreadable";

export type ReadResult = { ok: true; text: string } | { ok: false; reason: SkipReason };

/**
 * Read a small regular file without following untrusted symlinks, blocking on
 * special files, or reading more than MAX_CONFIG_BYTES. Never throws.
 */
export async function readConfigFile(file: string, opts: { fromWorkspace?: boolean } = {}): Promise<ReadResult> {
  try {
    if (opts.fromWorkspace && (await fs.lstat(file)).isSymbolicLink()) {
      return { ok: false, reason: "symlink" };
    }
  } catch (err) {
    return { ok: false, reason: isNotFound(err) ? "missing" : "unreadable" };
  }

  let handle: fs.FileHandle;
  try {
    // O_NONBLOCK: opening a FIFO for reading otherwise waits for a writer.
    // (Undefined on Windows, which has no FIFOs at ordinary paths.)
    handle = await fs.open(file, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0));
  } catch (err) {
    return { ok: false, reason: isNotFound(err) ? "missing" : "unreadable" };
  }
  try {
    const st = await handle.stat();
    if (!st.isFile()) {
      return { ok: false, reason: "not-a-file" };
    }
    if (st.size > MAX_CONFIG_BYTES) {
      return { ok: false, reason: "too-large" };
    }
    // Read at most the size fstat reported; a file growing meanwhile is cut off
    // (and then fails to parse, which counts as "no entry").
    const buf = Buffer.alloc(st.size);
    let filled = 0;
    while (filled < buf.length) {
      const { bytesRead } = await handle.read(buf, filled, buf.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    return { ok: true, text: buf.subarray(0, filled).toString("utf8") };
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/**
 * The first Mnemoverse entry in the given files, checked in order, or
 * `undefined`. A file that is missing, unsafe to read or not valid JSON(C)
 * counts as "no entry". `onSkip` hears about every skipped file except missing
 * ones, for the log.
 */
export async function findMnemoverseEntry(
  files: readonly ConfigFileRef[],
  onSkip?: (file: string, reason: Exclude<SkipReason, "missing">) => void,
): Promise<FoundEntry | undefined> {
  for (const ref of files) {
    const read = await readConfigFile(ref.file, { fromWorkspace: ref.fromWorkspace });
    if (!read.ok) {
      if (read.reason !== "missing") onSkip?.(ref.file, read.reason);
      continue;
    }
    const server = findMnemoverseServer(read.text);
    if (server !== undefined) {
      return { file: ref.file, server };
    }
  }
  return undefined;
}

/** `[".kiro/settings/mcp.json"]` → absolute paths under the home folder. */
export function homeConfigFiles(homePaths: readonly string[] | undefined): ConfigFileRef[] {
  const home = os.homedir();
  return (homePaths ?? []).map((p) => ({ file: path.join(home, ...p.split("/")) }));
}

/**
 * An absolute path as the user would write it: the home folder shown as `~`
 * (on every platform), so messages match the paths in the docs.
 */
export function displayPath(file: string): string {
  const home = os.homedir();
  return home && (file === home || file.startsWith(home + path.sep))
    ? "~" + file.slice(home.length).split(path.sep).join("/")
    : file;
}

function isNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
