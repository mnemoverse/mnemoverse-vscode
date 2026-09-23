import * as vscode from "vscode";
import type { HostId, HostKind } from "./hosts";
import { peekApiKey } from "./auth";
import { log } from "./log";

/**
 * What the extension has actually managed to do in this editor, and the one
 * place that turns it into user-visible state: the `mnemoverse.host` and
 * `mnemoverse.connected` context keys (walkthrough steps and palette `when`
 * clauses read them) and the status bar item.
 *
 * WHY A SINGLE SOURCE. Before 0.3.0 the extension said "memory connected"
 * after any successful sign-in — including in Cursor, where the MCP provider
 * API is a no-op stub and nothing was ever registered. "Connected" now has one
 * definition, computed here from facts the adapters report:
 *
 *   - lm, local  → the provider registered AND a key is stored.
 *   - lm, hosted → the provider registered (the editor runs its own OAuth on
 *                  first use; we cannot see that result, so we do not wait on it).
 *   - cursor     → Cursor accepted our registration, or the user's Cursor config
 *                  already had a Mnemoverse entry.
 *   - guidance   → never: nothing is registered on this host.
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
  /** Cursor only: an existing entry in the user's Cursor config was found, so nothing was added. */
  alreadyConfigured: boolean;
  /** A key is stored in SecretStorage (only meaningful for lm + local). */
  hasKey: boolean;
}

let snap: Snapshot = {
  // Until the adapter is chosen, behave as the most conservative host: nothing
  // registered, nothing claimed.
  host: { id: "unknown", kind: "guidance", appName: "" },
  registered: false,
  alreadyConfigured: false,
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

/** Record what the adapter achieved. */
export function setRegistered(registered: boolean, alreadyConfigured = false): void {
  snap = { ...snap, registered, alreadyConfigured };
  publish();
}

export function isRegistered(): boolean {
  return snap.registered;
}

export function isAlreadyConfigured(): boolean {
  return snap.alreadyConfigured;
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

/** The single definition of "connected" (see the module comment). */
export function isConnected(): boolean {
  switch (snap.host.kind) {
    case "lm":
      return snap.registered && (getConnectionMode() === "hosted" || snap.hasKey);
    case "cursor":
      return snap.registered;
    case "guidance":
      return false;
  }
}

/** Short state word plus one line of explanation, for the status bar tooltip. */
export function describeState(): { label: string; detail: string } {
  const app = appName();
  switch (snap.host.kind) {
    case "lm":
      if (getConnectionMode() === "hosted") {
        return {
          label: "Connected",
          detail: `Hosted server. ${app} asks you to sign in the first time the agent uses memory.`,
        };
      }
      return snap.hasKey
        ? { label: "Connected", detail: "Local server, signed in." }
        : { label: "Sign in", detail: 'Run "Mnemoverse: Sign In" to connect memory to the agent.' };
    case "cursor":
      return snap.alreadyConfigured
        ? { label: "Connected", detail: "Through the Mnemoverse entry in your Cursor MCP config." }
        : { label: "Added to Cursor", detail: "Sign in from Cursor Settings → Tools & MCPs." };
    case "guidance":
      return snap.host.fallbackFrom
        ? {
            label: "Set up needed",
            detail: `Mnemoverse could not add its server in ${app} (see "Mnemoverse: Show Log"). Add it to the MCP config instead ("Mnemoverse: Copy MCP Config").`,
          }
        : { label: "Set up needed", detail: `Add Mnemoverse to ${app}'s MCP config ("Mnemoverse: Copy MCP Config").` };
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
    statusItem.tooltip = `Mnemoverse Memory: ${label}\n${detail}\nClick for options.`;
    const show = vscode.workspace.getConfiguration("mnemoverse").get<boolean>("showStatusBar", true);
    if (show) statusItem.show();
    else statusItem.hide();
  }
}
