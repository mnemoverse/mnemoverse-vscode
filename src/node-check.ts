import * as vscode from "vscode";
import { findOnPath } from "./preflight";
import { noteOnboardingToast } from "./session";
import { log } from "./log";

/**
 * Node.js check for the LOCAL connection (npx + key). The hosted connection
 * spawns nothing and never calls into this module.
 *
 * VS Code already shows its own "npx not found" toast when a spawn fails, but
 * only after the user has signed in and an agent has reached for a memory tool,
 * and it cannot mention the one fix that needs no install at all: switching to
 * the hosted connection. We check at the two moments we control — right after
 * a successful sign-in, and in resolve before the spawn — and offer both fixes.
 */

/** Thrown from resolve so the chat surface shows the reason instead of a raw spawn error. */
export const NODE_MISSING_MESSAGE =
  "Mnemoverse's local server needs Node.js 18+ (npx was not found on PATH)";

export const NODE_DOWNLOAD_URL = "https://nodejs.org/en/download";

let nodePromptShownThisSession = false;

/**
 * Whether `npx` resolves on the extension host's PATH — the same environment
 * VS Code hands to the spawned server. Not cached: the lookup is a handful of
 * stat calls, and a cache would hide an install made after activation from
 * hosts that refresh their environment.
 */
export function isNpxAvailable(): boolean {
  return findOnPath("npx", process.env, process.platform) !== undefined;
}

/**
 * Tell the user once per session that the local server cannot start, with the
 * two ways out. Fire-and-forget: callers never await the user's choice.
 */
export async function promptNodeMissing(): Promise<void> {
  if (nodePromptShownThisSession) {
    return;
  }
  nodePromptShownThisSession = true;
  noteOnboardingToast();
  log.warn("npx was not found on PATH; the local server cannot start");
  const choice = await vscode.window.showWarningMessage(
    `${NODE_MISSING_MESSAGE}. Switch to the hosted connection (no Node.js needed), or install Node.js and restart the editor.`,
    "Use hosted connection",
    "Install Node.js",
  );
  if (choice === "Use hosted connection") {
    await vscode.commands.executeCommand("mnemoverse.useHostedConnection");
  } else if (choice === "Install Node.js") {
    await vscode.env.openExternal(vscode.Uri.parse(NODE_DOWNLOAD_URL));
  }
}
