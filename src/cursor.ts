import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import { HOSTED_MCP_URL } from "./hosts";
import { CONSOLE_BASE_URL } from "./signin-core";
import { getConfiguredEntry, setRegistered } from "./state";
import { findMnemoverseEntry, type ConfigFileRef, type FoundEntry } from "./config-files";
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
 *
 * THE AGENTS WINDOW DOES NOT RUN EXTENSIONS. Cursor 3's Agents Window ("glass"
 * mode) loads only Cursor's built-in extensions: launched with `--glass`, even
 * an explicitly loaded development extension is absent
 * (`vscode.extensions.getExtension` returns undefined; checked 2026-09-23 on
 * Cursor 3.21.16). So a registration made here reaches editor windows only.
 * To reach every window, the server has to be in the user's own Cursor MCP
 * settings (~/.cursor/mcp.json). "Add to Cursor" gets it there through Cursor's
 * own install deeplink, which opens Cursor's MCP settings and lets the user
 * confirm; this extension still never writes the file itself. Once the entry
 * exists, the extension withdraws its own registration so the tools are not
 * listed twice.
 */

/** The name passed to registerServer (Cursor shows it as "extension-mnemoverse"). */
export const CURSOR_SERVER_NAME = "mnemoverse";

/** How Cursor lists our server in its MCP settings. */
const CURSOR_LISTED_NAME = `extension-${CURSOR_SERVER_NAME}`;

/** The entry name "Add to Cursor" asks Cursor to write into ~/.cursor/mcp.json. */
export const CURSOR_SETTINGS_ENTRY_NAME = "mnemoverse";

/**
 * Cursor's documented MCP install deeplink
 * (`cursor://anysphere.cursor-deeplink/mcp/install?name=…&config=<base64 JSON>`).
 * Cursor's built-in cursor-deeplink extension decodes `config`, opens its MCP
 * settings and runs its own install, so the user confirms inside Cursor. The
 * config is the hosted URL only: no key, no headers.
 *
 * The base64 goes in raw, as in Cursor's docs: the handler reads it with
 * URLSearchParams, and this fixed config encodes to letters, digits and `=`
 * padding only (no `+`, which URLSearchParams would turn into a space). A unit
 * test pins that.
 */
export function cursorInstallDeeplink(): string {
  const config = Buffer.from(JSON.stringify({ url: HOSTED_MCP_URL }), "utf8").toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${CURSOR_SETTINGS_ENTRY_NAME}&config=${config}`;
}

/** Label of the action everywhere it appears (notice buttons, menu, walkthrough). */
export const ADD_TO_CURSOR_LABEL = "Add to Cursor (all windows)";

/** After "Add to Cursor", how often and how long to look for the new entry. */
export const ADOPT_POLL_MS = 2_000;
export const ADOPT_POLL_LIMIT_MS = 3 * 60_000;

/** Whether this activation registered "extension-mnemoverse" (so it can be withdrawn). */
let registeredByUs = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;

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
 * open workspace folder's .cursor/mcp.json (local folders only). Workspace
 * files come from whatever repository is open, so they are read with the
 * stricter rules in config-files.ts (no symlinks).
 */
function cursorConfigFiles(): ConfigFileRef[] {
  const files: ConfigFileRef[] = [{ file: path.join(os.homedir(), ".cursor", "mcp.json") }];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme === "file") {
      files.push({ file: path.join(folder.uri.fsPath, ".cursor", "mcp.json"), fromWorkspace: true });
    }
  }
  return files;
}

/**
 * Look for a Mnemoverse entry the user already has in a Cursor MCP config.
 * READ-ONLY: this version never writes any config file. A missing, unreadable,
 * oversized, special (FIFO, device) or invalid file counts as "no entry", and
 * only an exact match counts (see findMnemoverseServer).
 */
export async function findExistingCursorEntry(): Promise<FoundEntry | undefined> {
  return findMnemoverseEntry(cursorConfigFiles(), (file, reason) =>
    log.warn(`Cursor: skipped ${file} while looking for an existing Mnemoverse entry (${reason})`),
  );
}

export interface CursorStartResult {
  /** Cursor will offer Mnemoverse to its agent (registered now, or configured by the user). */
  registered: boolean;
  /** Found in the user's own config; the extension added nothing. */
  configuredIn?: FoundEntry;
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
    log.info(
      `Cursor: Mnemoverse is already configured in ${existing.file} (server "${existing.server}"); not registering a second copy`,
    );
    return { registered: true, configuredIn: existing };
  }
  const api = cursorMcpApi();
  if (!api) {
    throw new Error("vscode.cursor.mcp.registerServer is not available");
  }
  // No `headers`: Cursor drops them, and the hosted server wants its own OAuth token.
  await Promise.resolve(api.registerServer({ name: CURSOR_SERVER_NAME, server: { url: HOSTED_MCP_URL } }));
  registeredByUs = true;
  log.info(
    `Cursor: registered ${HOSTED_MCP_URL} as "${CURSOR_LISTED_NAME}" (editor windows only; the Agents Window runs no extensions)`,
  );
  return { registered: true };
}

/**
 * The user's own Cursor MCP settings now have Mnemoverse (after "Add to
 * Cursor", or added some other way while this window was open). Record it,
 * and withdraw our in-window registration so the tools are not listed twice.
 *
 * Unregistering here is safe, unlike on dispose: it clears the OAuth state of
 * "extension-mnemoverse" only, the copy being removed, and Cursor keeps a
 * separate sign-in for the user's own entry.
 */
async function adoptUserEntry(found: FoundEntry): Promise<void> {
  if (registeredByUs) {
    try {
      await Promise.resolve(cursorMcpApi()?.unregisterServer(CURSOR_SERVER_NAME));
      registeredByUs = false;
      log.info(`Cursor: withdrew "${CURSOR_LISTED_NAME}"; ${found.file} has Mnemoverse for every window`);
    } catch (err) {
      log.error(`Cursor: could not withdraw "${CURSOR_LISTED_NAME}"; it disappears on the next window reload`, err);
    }
  }
  setRegistered(true, found);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

/**
 * Look for the user's own entry once; adopt it if it is there. Returns whether
 * it was found. Never throws (findExistingCursorEntry reads defensively).
 */
export async function recheckCursorSettings(): Promise<boolean> {
  if (getConfiguredEntry()) {
    return true;
  }
  const found = await findExistingCursorEntry();
  if (!found) {
    return false;
  }
  stopPolling();
  await adoptUserEntry(found);
  return true;
}

/**
 * `mnemoverse.addToCursor`: open Cursor's install deeplink, then watch
 * ~/.cursor/mcp.json for the entry (every ADOPT_POLL_MS for up to
 * ADOPT_POLL_LIMIT_MS; the user confirms in Cursor's own UI, which can take a
 * while). The file is only read, with the same size and type limits as at
 * startup.
 */
export async function addToCursorSettings(): Promise<void> {
  if (await recheckCursorSettings()) {
    const entry = getConfiguredEntry();
    const choice = await vscode.window.showInformationMessage(
      `Mnemoverse is already in your Cursor MCP settings${entry ? ` as "${entry.server}"` : ""}, so every Cursor window can use it. Sign in from Cursor Settings → Tools & MCPs if you haven't yet.`,
      "Open MCP settings",
    );
    if (choice === "Open MCP settings") {
      await openCursorMcpSettings();
    }
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(cursorInstallDeeplink()));
  log.info("Cursor: opened the MCP install deeplink; waiting for the entry in ~/.cursor/mcp.json");
  stopPolling();
  const started = Date.now();
  let inFlight = false; // a slow read must not overlap the next tick and adopt twice
  pollTimer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void (async () => {
      if (Date.now() - started > ADOPT_POLL_LIMIT_MS) {
        stopPolling();
        log.info("Cursor: stopped waiting for the MCP settings entry (it is picked up on the next window reload)");
        return;
      }
      if (await recheckCursorSettings()) {
        const entry = getConfiguredEntry();
        void vscode.window.showInformationMessage(
          `Mnemoverse is now in your Cursor MCP settings${entry ? ` as "${entry.server}"` : ""}, for every window including the Agents Window. Sign in there: click Connect next to it in Cursor Settings → Tools & MCPs.`,
        );
      }
    })().finally(() => {
      inFlight = false;
    });
  }, ADOPT_POLL_MS);
}

/** Stops the settings watcher; pushed to context.subscriptions by activate(). */
export const cursorPollingDisposable = new vscode.Disposable(stopPolling);

/**
 * How Cursor lists the Mnemoverse server this user has: ours
 * ("extension-mnemoverse"), or the entry from their own config, by name.
 */
function listedServerName(): string {
  return getConfiguredEntry()?.server ?? CURSOR_LISTED_NAME;
}

/** The sign-in steps in words, for when no settings command can be found. */
export function cursorSignInSteps(): string {
  return `Open Cursor Settings → Tools & MCPs and click Connect (or Login) next to "${listedServerName()}". Cursor opens the browser to sign you in.`;
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
    `Mnemoverse was added to this Cursor window as "${CURSOR_LISTED_NAME}". Cursor's Agents Window doesn't run extensions: to use memory in every window, add it to your Cursor MCP settings, then click Connect next to it.`,
    ADD_TO_CURSOR_LABEL,
    "Open MCP settings",
  );
  if (choice === ADD_TO_CURSOR_LABEL) {
    await addToCursorSettings();
  } else if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
  }
}

/**
 * What Sign In / Complete sign-in do in Cursor: explain Cursor's sign-in path
 * instead of minting a key nothing in Cursor would use.
 */
export async function explainCursorSignIn(): Promise<void> {
  // Until the user's own settings have Mnemoverse, the in-window registration
  // is all there is, and the Agents Window can't see it: offer the fix first.
  const buttons = getConfiguredEntry() ? ["Open MCP settings"] : [ADD_TO_CURSOR_LABEL, "Open MCP settings"];
  const choice = await vscode.window.showInformationMessage(
    `In Cursor, Mnemoverse signs in through Cursor itself, not this command. ${cursorSignInSteps()}`,
    ...buttons,
  );
  if (choice === ADD_TO_CURSOR_LABEL) {
    await addToCursorSettings();
  } else if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
  }
}

/**
 * Sign Out in Cursor. The sign-in Cursor's agent uses is Cursor's own OAuth
 * session for the server; this extension never held it and cannot end it
 * through a documented API. (`unregisterServer` would clear it as a side
 * effect in Cursor 3.21, but that is undocumented behaviour and would also
 * remove the server.) So say plainly where the real sign-out is, instead of
 * reporting "signed out" while memory keeps working.
 *
 * `removedKey`: the caller already deleted a key this extension had stored
 * (0.2.x minted one in Cursor too, and Cursor never used it). It stays valid on
 * the server, so the console link is offered.
 */
export async function explainCursorSignOut(removedKey: boolean): Promise<void> {
  const keyNote = removedKey
    ? " The unused key this extension had stored was removed from this device; it stays valid until you revoke it in the console."
    : "";
  const buttons = removedKey ? ["Open MCP settings", "Open console"] : ["Open MCP settings"];
  const choice = await vscode.window.showInformationMessage(
    `Cursor holds the Mnemoverse sign-in, not this extension. To sign out, open Cursor Settings → Tools & MCPs and click Logout next to "${listedServerName()}".${keyNote}`,
    ...buttons,
  );
  if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
  } else if (choice === "Open console") {
    await vscode.env.openExternal(vscode.Uri.parse(CONSOLE_BASE_URL));
  }
}

/**
 * Set API Key in Cursor: nothing in Cursor would read the key. SecretStorage
 * belongs to each application, so a key saved here is not visible to VS Code
 * either — storing it would only suggest that something changed. Explain
 * Cursor's sign-in instead and store nothing.
 */
export async function explainKeyNotUsedInCursor(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Cursor doesn't use a Mnemoverse API key: memory connects through Cursor's own sign-in (Cursor Settings → Tools & MCPs). Nothing was saved.",
    "Open MCP settings",
  );
  if (choice === "Open MCP settings") {
    await openCursorMcpSettings();
  }
}
