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
 * Ask the user to paste a Mnemoverse API key. Prompt ONLY: nothing is read from
 * or written to SecretStorage here. Returns the normalized key, or `undefined`
 * if the user dismissed the box.
 *
 * WHY PROMPT-ONLY (0.3.0). The old `getApiKey` read-or-prompt-and-store helper
 * pushed `mnemoverse.setApiKey` into clearing the stored key first so the
 * prompt would appear — and pressing Escape then left the user signed out with
 * no message, while the running server kept the old key until its next
 * restart. The command now prompts first and stores only a valid entry
 * (`storeApiKey` overwrites), so cancelling leaves the existing key untouched.
 */
export async function promptForApiKey(): Promise<string | undefined> {
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

  // The same guard the keyless flow and storeApiKey use, so a bare, empty or
  // wrong-prefix key can never be returned (validateInput already blocks it in
  // the UI; this is the authoritative check).
  return normalizeApiKey(entered);
}

/**
 * Store an API key, overwriting any existing one. Used by the keyless browser
 * sign-in after it exchanges the one-time code for the real key, and by
 * `mnemoverse.setApiKey` after a valid paste. Writes the single SecretStorage
 * slot the MCP provider reads, so the next resolve injects the new key.
 */
export async function storeApiKey(
  context: vscode.ExtensionContext,
  key: string,
): Promise<void> {
  // Reject a malformed key (same check promptForApiKey applies to pasted keys)
  // so a bad value from any source can't silently break later auth.
  await context.secrets.store(SECRET_KEY, normalizeApiKey(key));
}

/**
 * Read the stored API key WITHOUT prompting. The MCP provider's resolve path
 * and the first-run welcome use this: neither may pop the paste input box —
 * that would bypass the keyless Sign In flow (the headline of v0.2.0). Returns
 * `undefined` when nothing is stored, so callers route the user to Sign In.
 */
export async function peekApiKey(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(SECRET_KEY);
}

/**
 * Delete the stored API key. Called only by `mnemoverse.clearApiKey` and Sign
 * Out — never as a side effect of prompting (see promptForApiKey).
 */
export async function clearApiKey(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete(SECRET_KEY);
}
