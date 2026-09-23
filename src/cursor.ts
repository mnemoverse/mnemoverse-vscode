import * as vscode from "vscode";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HOSTED_MCP_URL, findMnemoverseServer } from "./hosts";
import { isAlreadyConfigured } from "./state";
import { noteOnboardingToast } from "./session";
import { log } from "./log";

/**
 * The `cursor` adapter.
 *
 * Cursor stubs `vscode.lm.registerMcpServerDefinitionProvider` (it logs "not
 * supported in Cursor" and returns a no-op disposable) and offers its own API
 * instead: `vscode.cursor.mcp.registerServer({ name, server })`, documented at
 * cursor.com/docs/context/mcp-extension-api.
 *
 * We register the HOSTED endpoint, not the local npx server:
 *
 *   - Cursor 3.21 keeps only `url` for remote servers and silently drops
 *     `headers` (checked in its bundle; acknowledged on the Cursor forum), so a
 *     key cannot be passed that way — and the hosted server takes OAuth tokens,
 *     not keys, anyway.
 *   - Cursor runs its own MCP OAuth for remote servers. auth.mnemoverse.com
 *     already allows Cursor's callback (cursor://anysphere.cursor-mcp/), so the
 *     user signs in from Cursor Settings → Tools & MCPs; this extension holds no
 *     key in Cursor.
 *   - It avoids Cursor's extension-provided stdio regressions (forum 163151).
 *
 * Cursor names the server `extension-<name>`, so ours appears as
 * "extension-mnemoverse". Registration lives in Cursor's memory only, so it is
 * repeated on every activation; Cursor ignores a second registration of the
 * same name from the same extension.
 */

/** The name passed to registerServer (Cursor shows it as "extension-mnemoverse"). */
export const CURSOR_SERVER_NAME = "mnemoverse";

/** How Cursor lists our server in its MCP settings. */
const CURSOR_LISTED_NAME = `extension-${CURSOR_SERVER_NAME}`;

/**
 * Commands that open Cursor's MCP settings, tried in order. Both exist in Cursor
 * 3.21.16: the per-tab `aiSettings.action.open.mcp` ("Cursor Settings: Tools &
 * MCPs") and the generic `aiSettings.action.open` with the tab id. Neither is
 * documented, so each is used only if `getCommands` lists it.
 */
export const CURSOR_MCP_SETTINGS_COMMANDS: ReadonlyArray<{ id: string; args: unknown[] }> = [
  { id: "aiSettings.action.open.mcp", args: [] },
  { id: "aiSettings.action.open", args: ["mcp"] },
];

interface CursorMcpApi {
  registerServer(config: { name: string; server: { url: string } }): unknown;
  unregisterServer(name: string): unknown;
}

/** `vscode.cursor.mcp`, if this host has it. Not in @types/vscode, hence the cast. */
function cursorMcpApi(): CursorMcpApi | undefined {
  const mcp = (vscode as unknown as { cursor?: { mcp?: Partial<CursorMcpApi> } }).cursor?.mcp;
  return typeof mcp?.registerServer === "function" ? (mcp as CursorMcpApi) : undefined;
}

/**
 * The MCP config files Cursor reads: the global ~/.cursor/mcp.json and each
 * open workspace folder's .cursor/mcp.json (local folders only).
 */
function cursorConfigFiles(): string[] {
  const files = [path.join(os.homedir(), ".cursor", "mcp.json")];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme === "file") {
      files.push(path.join(folder.uri.fsPath, ".cursor", "mcp.json"));
    }
  }
  return files;
}

/**
 * Look for a Mnemoverse entry the user already has in a Cursor MCP config.
 * READ-ONLY: this version never writes any config file. A missing, unreadable
 * or invalid file counts as "no entry".
 *
 * Returns a short description for the log ("<file> (server "<name>")"), or
 * `undefined`.
 */
export async function findExistingCursorEntry(): Promise<string | undefined> {
  for (const file of cursorConfigFiles()) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue; // missing or unreadable: nothing to duplicate
    }
    const name = findMnemoverseServer(text);
    if (name !== undefined) {
      return `${file} (server "${name}")`;
    }
  }
  return undefined;
}

export interface CursorStartResult {
  /** Cursor will offer Mnemoverse to its agent (registered now, or configured by the user). */
  registered: boolean;
  /** Found in the user's own config; the extension added nothing. */
  alreadyConfigured: boolean;
}

/**
 * Register the hosted server with Cursor, unless the user's config already has
 * one (then every tool would show twice). Throws if the Cursor API is missing
 * or rejects; activate() then falls back to guidance mode.
 *
 * NOT UNREGISTERED ON DISPOSE — a deliberate choice. In Cursor 3.21,
 * `unregisterServer` also clears the server's identifier-scoped OAuth state
 * (it calls clearServerOAuthState for streamable-HTTP servers, which runs a
 * LogoutServer in "identifier" mode). Extension disposal runs
 * on every extension-host shutdown — window reload, "Restart Extensions" after
 * an update — so an unregister there could sign the user out of Mnemoverse in
 * Cursor on each restart. Leaving the registration costs nothing: it lives in
 * Cursor's memory and disappears with the window, and a re-registration of the
 * same name is ignored.
 */
export async function startCursorAdapter(): Promise<CursorStartResult> {
  const existing = await findExistingCursorEntry();
  if (existing) {
    log.info(`Cursor: Mnemoverse is already configured in ${existing}; not registering a second copy`);
    return { registered: true, alreadyConfigured: true };
  }
  const api = cursorMcpApi();
  if (!api) {
    throw new Error("vscode.cursor.mcp.registerServer is not available");
  }
  // No `headers`: Cursor drops them, and the hosted server wants its own OAuth token.
  await Promise.resolve(api.registerServer({ name: CURSOR_SERVER_NAME, server: { url: HOSTED_MCP_URL } }));
  log.info(`Cursor: registered ${HOSTED_MCP_URL} as "${CURSOR_LISTED_NAME}"`);
  return { registered: true, alreadyConfigured: false };
}

/** The sign-in steps in words, for when no settings command can be found. */
export function cursorSignInSteps(): string {
  return isAlreadyConfigured()
    ? "Open Cursor Settings → Tools & MCPs and click Connect (or Login) next to your Mnemoverse server."
    : `Open Cursor Settings → Tools & MCPs and click Connect (or Login) next to "${CURSOR_LISTED_NAME}". Cursor opens the browser to sign you in.`;
}

/**
 * Open Cursor's MCP settings with the first command this build has. Falls back
 * to showing the steps as text. Never throws.
 */
export async function openCursorMcpSettings(): Promise<void> {
  try {
    const available = new Set(await vscode.commands.getCommands(true));
    for (const c of CURSOR_MCP_SETTINGS_COMMANDS) {
      if (!available.has(c.id)) continue;
      try {
        await vscode.commands.executeCommand(c.id, ...c.args);
        return;
      } catch (err) {
        log.warn(`Cursor: ${c.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    log.error("Cursor: could not list commands", err);
  }
  await vscode.window.showInformationMessage(cursorSignInSteps());
}

const CURSOR_INTRO_SHOWN_KEY = "mnemoverse.cursorIntroShown";

/**
 * One-time notice after the first successful registration: where the server
 * went and how to finish (Cursor's own sign-in). Once ever, persisted.
 */
export async function showCursorIntro(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(CURSOR_INTRO_SHOWN_KEY, false)) {
    return;
  }
  await context.globalState.update(CURSOR_INTRO_SHOWN_KEY, true);
  noteOnboardingToast();
  const choice = await vscode.window.showInformationMessage(
    `Mnemoverse was added to Cursor's MCP servers as "${CURSOR_LISTED_NAME}". To finish, sign in from Cursor Settings → Tools & MCPs: click Connect (or Login) next to it.`,
    "Open MCP settings",
  );
  if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
  }
}

/**
 * What Sign In / Complete sign-in do in Cursor: explain Cursor's sign-in path
 * instead of minting a key nothing in Cursor would use.
 */
export async function explainCursorSignIn(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `In Cursor, Mnemoverse signs in through Cursor itself, not this command. ${cursorSignInSteps()}`,
    "Open MCP settings",
  );
  if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
  }
}

/**
 * Set API Key in Cursor: still allowed (the key is harmless and a user may
 * share settings with another editor), but explain first that Cursor does not
 * use it. Returns true if the user still wants to paste a key.
 */
export async function confirmSetKeyInCursor(): Promise<boolean> {
  const choice = await vscode.window.showInformationMessage(
    "In Cursor, memory connects through Cursor's own sign-in (Cursor Settings → Tools & MCPs). A key set here is only used by the local server this extension runs in VS Code-style editors; Cursor does not run that server through this extension.",
    "Open MCP settings",
    "Set key anyway",
  );
  if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
    return false;
  }
  return choice === "Set key anyway";
}
