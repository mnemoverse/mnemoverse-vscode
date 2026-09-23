import * as vscode from "vscode";
import type { HostId, HostKind } from "./hosts";
import { mcpConfigTargetFor } from "./hosts";
import { peekApiKey } from "./auth";
import { isNpxAvailable } from "./node-check";
import { displayPath, type FoundEntry } from "./config-files";
import { log } from "./log";

/**
 * What the extension has actually managed to do in this editor, and the one
 * place that turns it into user-visible state: the `mnemoverse.host` and
 * `mnemoverse.connected` context keys (walkthrough steps, palette `when`
 * clauses and the chat skill read them) and the status bar item.
 *
 * WHY A SINGLE SOURCE. Before 0.3.0 the extension said "memory connected"
 * after any successful sign-in — including in Cursor, where the MCP provider
 * API is a no-op stub and nothing was ever registered. The states are now
 * computed here, from facts the adapters report, and nowhere else.
 *
 * Two questions, answered separately because they differ:
 *
 * `isConnected()` — "the editor's agent has the Mnemoverse server, and nothing
 * more is needed from THIS extension" (the `mnemoverse.connected` key):
 *
 *   - lm, local  → the provider registered AND a key is stored AND npx is on
 *                  PATH (without Node every server start fails, so a stored key
 *                  alone is not a connection).
 *   - lm, hosted → the provider registered; the editor runs its own OAuth on
 *                  first use.
 *   - cursor     → Cursor accepted our registration, or the user's Cursor config
 *                  already had a Mnemoverse entry; Cursor runs the sign-in.
 *   - guidance   → never: nothing is registered on this host.
 *
 * `isKnownSetUp()` — "memory is known to be set up, not merely offered", for
 * the rating prompt, which must not reach someone for whom memory never
 * worked. It drops the cases where the extension only put a server in front of
 * the editor's own, invisible sign-in: a Cursor registration nobody may have
 * logged in to. It keeps lm (a key was minted, or the user chose the hosted
 * connection on purpose) and any entry the user added to a config file by hand.
 *
 * The user-visible labels never say "Connected" for a server the extension did
 * not register and cannot see signed in: those read "Added to <editor>" or
 * "In your MCP config".
 *
 * Module-level like session.ts: the state lives exactly as long as the
 * extension host session.
 */

export type ConnectionMode = "local" | "hosted";

export interface HostInfo {
  id: HostId;
  kind: HostKind;
  /** `vscode.env.appName`, used in user-facing text. */
  appName: string;
  /**
   * Set when `kind` is "guidance" only because the detected adapter failed to
   * start (the log has the error). The text then says registration failed,
   * rather than claiming the editor has no API for it.
   */
  fallbackFrom?: HostKind;
}

interface Snapshot {
  host: HostInfo;
  /** The adapter registered something the editor will use. */
  registered: boolean;
  /**
   * A Mnemoverse entry the user already has in the editor's own MCP config
   * (Cursor: then the extension registered nothing; config-file editors: the
   * user finished the setup). Read-only discovery, never written.
   */
  configuredIn: FoundEntry | undefined;
  /** A key is stored in SecretStorage (only meaningful for lm + local). */
  hasKey: boolean;
}

let snap: Snapshot = {
  // Until the adapter is chosen, behave as the most conservative host: nothing
  // registered, nothing claimed.
  host: { id: "unknown", kind: "guidance", appName: "" },
  registered: false,
  configuredIn: undefined,
  hasKey: false,
};

let statusItem: vscode.StatusBarItem | undefined;

/** `mnemoverse.connection`, validated. Anything unexpected reads as the default, "local". */
export function getConnectionMode(): ConnectionMode {
  const v = vscode.workspace.getConfiguration("mnemoverse").get<string>("connection", "local");
  return v === "hosted" ? "hosted" : "local";
}

export function getHost(): HostInfo {
  return snap.host;
}

/** The editor's display name for user-facing text, e.g. "Cursor". */
export function appName(): string {
  return snap.host.appName || vscode.env.appName || "your editor";
}

export function setHost(host: HostInfo): void {
  snap = { ...snap, host };
  publish();
}

/** Record what the adapter achieved, and any entry found in the user's own config. */
export function setRegistered(registered: boolean, configuredIn?: FoundEntry): void {
  snap = { ...snap, registered, configuredIn };
  publish();
}

export function isRegistered(): boolean {
  return snap.registered;
}

/** Whether the user's own MCP config already has Mnemoverse (see `configuredIn`). */
export function isAlreadyConfigured(): boolean {
  return snap.configuredIn !== undefined;
}

/** The entry found in the user's own MCP config, if any. */
export function getConfiguredEntry(): FoundEntry | undefined {
  return snap.configuredIn;
}

/** Re-read whether a key is stored, then republish. Never prompts. */
export async function refreshKeyState(context: vscode.ExtensionContext): Promise<void> {
  try {
    snap = { ...snap, hasKey: !!(await peekApiKey(context)) };
  } catch (err) {
    // A locked keychain must not break the status bar; treat as "no key".
    log.error("Could not read the stored key state", err);
    snap = { ...snap, hasKey: false };
  }
  publish();
}

export function hasKey(): boolean {
  return snap.hasKey;
}

/**
 * Whether the local server can start: npx on PATH. Not cached (a few stat
 * calls, see node-check.ts), so an install the host's PATH picks up counts at
 * the next refresh.
 */
function localServerCanStart(): boolean {
  return isNpxAvailable();
}

/** The `mnemoverse.connected` definition (see the module comment). */
export function isConnected(): boolean {
  switch (snap.host.kind) {
    case "lm":
      if (!snap.registered) return false;
      return getConnectionMode() === "hosted" || (snap.hasKey && localServerCanStart());
    case "cursor":
      return snap.registered;
    case "guidance":
      return false;
  }
}

/** Whether memory is known to be set up, for the rating prompt (see the module comment). */
export function isKnownSetUp(): boolean {
  switch (snap.host.kind) {
    case "lm":
      return isConnected();
    case "cursor":
    case "guidance":
      return snap.configuredIn !== undefined;
  }
}

/** `"mnemoverse" in ~/.kiro/settings/mcp.json` — for tooltips and messages. */
export function describeConfiguredEntry(entry: FoundEntry): string {
  return `"${entry.server}" in ${displayPath(entry.file)}`;
}

/** Short state word plus one line of explanation, for the status bar tooltip and menu. */
export function describeState(): { label: string; detail: string } {
  const app = appName();
  const found = snap.configuredIn;
  switch (snap.host.kind) {
    case "lm":
      if (getConnectionMode() === "hosted") {
        // Not "Connected": the editor's OAuth result is invisible to us.
        return {
          label: `Added to ${app}`,
          detail: `Hosted server. ${app} asks you to sign in the first time the agent uses memory.`,
        };
      }
      if (!localServerCanStart()) {
        return {
          label: "Node.js needed",
          detail: snap.hasKey
            ? `Signed in, but the local server needs Node.js 18+ (npx was not found on PATH). Install Node.js and restart ${app}, or use the hosted connection.`
            : `The local server needs Node.js 18+ (npx was not found on PATH). Use the hosted connection, or install Node.js, restart ${app} and sign in.`,
        };
      }
      return snap.hasKey
        ? { label: "Connected", detail: "Local server, signed in." }
        : { label: "Sign in", detail: 'Run "Mnemoverse: Sign In" to connect memory to the agent.' };
    case "cursor":
      return found
        ? {
            label: "In your MCP config",
            detail: `Cursor uses the Mnemoverse entry ${describeConfiguredEntry(found)}; this extension added nothing. Cursor runs its sign-in (Cursor Settings → Tools & MCPs).`,
          }
        : { label: "Added to Cursor", detail: "Sign in from Cursor Settings → Tools & MCPs." };
    case "guidance":
      if (found) {
        return {
          label: "In your MCP config",
          detail: `Found the Mnemoverse entry ${describeConfiguredEntry(found)}. ${app} runs its sign-in.`,
        };
      }
      if (snap.host.fallbackFrom) {
        return {
          label: "Not added",
          detail: `Mnemoverse could not add its server in ${app} (see "Mnemoverse: Show Log"). If you haven't yet, add it to the MCP config ("Mnemoverse: Copy MCP Config").`,
        };
      }
      // Only claim "set up needed" where the file was actually checked;
      // elsewhere the text has to stay true after the user finishes the setup.
      return mcpConfigTargetFor(snap.host.id).homePaths
        ? { label: "Set up needed", detail: `Add Mnemoverse to ${app}'s MCP config ("Mnemoverse: Copy MCP Config").` }
        : {
            label: "Add via MCP config",
            detail: `${app} reads MCP servers from its own config, which this extension can't check. If Mnemoverse isn't there yet, add it ("Mnemoverse: Copy MCP Config").`,
          };
  }
}

/** Create the status bar item. Its visibility follows `mnemoverse.showStatusBar`. */
export function initStatusBar(): vscode.Disposable {
  statusItem = vscode.window.createStatusBarItem("mnemoverse.status", vscode.StatusBarAlignment.Right, 100);
  statusItem.name = "Mnemoverse";
  statusItem.text = "$(database) Mnemoverse";
  statusItem.command = "mnemoverse.showMenu";
  publish();
  const item = statusItem;
  return new vscode.Disposable(() => {
    item.dispose();
    if (statusItem === item) statusItem = undefined;
  });
}

/** Push the current state to the context keys and the status bar. */
export function publish(): void {
  const connected = isConnected();
  // setContext is fire-and-forget: a failure only affects `when` clauses.
  void Promise.resolve(vscode.commands.executeCommand("setContext", "mnemoverse.host", snap.host.kind)).catch(() => undefined);
  void Promise.resolve(vscode.commands.executeCommand("setContext", "mnemoverse.connected", connected)).catch(() => undefined);

  if (statusItem) {
    const { label, detail } = describeState();
    statusItem.tooltip = `Mnemoverse: ${label}\n${detail}\nClick for options.`;
    const show = vscode.workspace.getConfiguration("mnemoverse").get<boolean>("showStatusBar", true);
    if (show) statusItem.show();
    else statusItem.hide();
  }
}
