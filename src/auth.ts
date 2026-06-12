import * as vscode from "vscode";
import { normalizeApiKey } from "./signin-core";

/**
 * Key under which the Mnemoverse API key is stored in the extension's
 * SecretStorage. SecretStorage is backed by the OS keychain (macOS Keychain,
 * Windows Credential Vault, Linux libsecret) — the key never hits plain disk.
 *
 * NEVER read/write this via `context.globalState` or `workspaceState`:
 * those are plaintext SQLite and the user could accidentally commit them.
 */
const SECRET_KEY = "mnemoverse.apiKey";

/**
 * Return the user's Mnemoverse API key. If none is stored, prompt the user
 * for one and store it. If the user cancels the prompt, return `undefined`
 * so the caller can decide how to handle the missing credential (for the
 * MCP provider, that means throwing so Copilot shows a visible error).
 *
 * This function is the ONE entry point for "give me the current API key":
 * both the MCP provider's `resolveMcpServerDefinition` and the
 * `mnemoverse.setApiKey` command call it. Keeping the logic in one place
 * means a future OAuth migration only needs to touch this file.
 */
export async function getApiKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  const existing = await context.secrets.get(SECRET_KEY);
  if (existing) {
    return existing;
  }

  const entered = await vscode.window.showInputBox({
    title: "Mnemoverse API key",
    prompt:
      "Paste your Mnemoverse API key. Get a free one at https://console.mnemoverse.com",
    placeHolder: "mk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "API key is required";
      }
      if (!trimmed.startsWith("mk_live_") || trimmed.length <= "mk_live_".length) {
        return 'Key should start with "mk_live_" — get yours at console.mnemoverse.com';
      }
      return undefined;
    },
  });

  if (!entered) {
    return undefined;
  }

  // Persist through the same guard the keyless flow uses, so the paste path
  // can't store a bare/empty/wrong-prefix key either (validateInput already
  // blocks it in the UI; this is the single, authoritative store gate).
  const key = normalizeApiKey(entered);
  await context.secrets.store(SECRET_KEY, key);
  return key;
}

/**
 * Store an API key obtained WITHOUT a prompt — used by the keyless browser
 * sign-in flow after it exchanges the one-time code for the real key. Writes to
 * the SAME SecretStorage slot getApiKey reads, so the MCP provider picks it up
 * with zero changes to its injection path.
 */
export async function storeApiKey(
  context: vscode.ExtensionContext,
  key: string,
): Promise<void> {
  // Reject a malformed key (same check getApiKey applies to pasted keys) so a
  // bad value from any source can't silently break later auth.
  await context.secrets.store(SECRET_KEY, normalizeApiKey(key));
}

/**
 * Delete the stored API key. Called by the `mnemoverse.clearApiKey` command
 * and indirectly by `mnemoverse.setApiKey` (to force a re-prompt when the
 * user wants to rotate their key without reinstalling the extension).
 */
export async function clearApiKey(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
}
