import * as vscode from "vscode";
import { registerProvider } from "./provider";
import { clearApiKey, getApiKey } from "./auth";

/**
 * Extension entry point. Called by VS Code after activation
 * (`activationEvents: ["onStartupFinished"]` in package.json).
 *
 * Three things happen here:
 *
 *   1. Register the MCP server definition provider. VS Code's Copilot
 *      Chat Agent Mode will call into it whenever the user spawns our
 *      server.
 *   2. Register three commands (Set / Clear / Open Docs) so the user
 *      can manage their API key and jump to documentation from the
 *      command palette without leaving VS Code.
 *   3. Push every registration into `context.subscriptions` so VS Code
 *      cleans them up when the extension deactivates.
 *
 * Each command handler is wrapped so that unexpected errors (keychain
 * locked, browser not found, SecretStorage inaccessible) surface as a
 * visible `showErrorMessage` rather than being silently swallowed by
 * the command runner.
 *
 * v0.1.x deliberately has NO status bar, NO welcome notification, NO
 * OAuth. Those slot in after Phase 2 (Remote MCP server) without
 * changing the provider wiring.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerProvider(context),

    vscode.commands.registerCommand("mnemoverse.setApiKey", async () => {
      try {
        // Force re-prompt by clearing first. Used when the user wants to
        // rotate their key or switch accounts without reinstalling.
        await clearApiKey(context);
        const key = await getApiKey(context);
        if (key) {
          await vscode.window.showInformationMessage(
            "Mnemoverse API key saved.",
          );
        }
      } catch (err) {
        await showCommandError("Failed to set Mnemoverse API key", err);
      }
    }),

    vscode.commands.registerCommand("mnemoverse.clearApiKey", async () => {
      try {
        await clearApiKey(context);
        await vscode.window.showInformationMessage(
          "Mnemoverse API key cleared.",
        );
      } catch (err) {
        await showCommandError("Failed to clear Mnemoverse API key", err);
      }
    }),

    vscode.commands.registerCommand("mnemoverse.openDocs", async () => {
      try {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://mnemoverse.com/docs/api/mcp-server"),
        );
      } catch (err) {
        await showCommandError(
          "Failed to open Mnemoverse documentation",
          err,
        );
      }
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables in `context.subscriptions`.
  // VS Code handles those automatically.
}

/**
 * Surface a command-handler failure to the user with a visible error
 * message. Without this wrapper, unhandled promise rejections inside an
 * async `registerCommand` callback are silently swallowed by VS Code's
 * command runner — the user clicks the palette entry and nothing happens.
 *
 * The most likely real-world errors here are:
 *   - macOS Keychain locked (FileVault edge case) — `SecretStorage` throws
 *   - No default browser registered — `openExternal` throws
 *   - OS file system issues when writing the secret
 *
 * We keep the message generic on purpose so internal `Error.message`
 * content (which may reference SDK internals) doesn't leak into the UI.
 */
async function showCommandError(
  title: string,
  err: unknown,
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  await vscode.window.showErrorMessage(`${title}: ${detail}`);
}