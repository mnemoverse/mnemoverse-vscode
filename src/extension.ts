import * as vscode from "vscode";
import { registerProvider } from "./provider";
import { clearApiKey, getApiKey, peekApiKey } from "./auth";
import { signIn, signOut, handleUri } from "./signin";
import { promptConnect, wasConnectPromptShown } from "./prompts";
import { shouldShowWelcome } from "./signin-core";

/** globalState flag: the first-run welcome has been shown once (ever). */
const WELCOME_SHOWN_KEY = "mnemoverse.welcomeShown";

/**
 * Extension entry point. Called by VS Code after activation
 * (`activationEvents: ["onStartupFinished"]` in package.json).
 *
 * Four things happen here:
 *
 *   1. Register the MCP server definition provider. VS Code's Copilot
 *      Chat Agent Mode will call into it whenever the user spawns our
 *      server.
 *   2. Register the URI handler for the keyless sign-in callback.
 *   3. Register the commands (Sign In / Sign Out / Set / Clear / Open
 *      Docs) so the user can connect, manage their key, and jump to
 *      documentation from the command palette without leaving VS Code.
 *   4. Push every registration into `context.subscriptions` so VS Code
 *      cleans them up when the extension deactivates, then show the
 *      one-time first-run welcome if no key is stored yet.
 *
 * Each command handler is wrapped so that unexpected errors (keychain
 * locked, browser not found, SecretStorage inaccessible) surface as a
 * visible `showErrorMessage` rather than being silently swallowed by
 * the command runner.
 *
 * No status bar and no server-side OAuth yet — those slot in after the
 * Remote MCP server (v0.3) without changing the provider wiring.
 */
export function activate(context: vscode.ExtensionContext): void {
  // Fired after sign-in / sign-out so VS Code re-resolves the MCP server with
  // the new (or cleared) key. Owned here and disposed via subscriptions.
  const serverChanged = new vscode.EventEmitter<void>();
  const fireServerChanged = () => serverChanged.fire();

  context.subscriptions.push(
    serverChanged,
    registerProvider(context, serverChanged.event),

    // Browser keyless sign-in returns here via vscode://Mnemoverse.mnemoverse-vscode/auth-callback.
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        void handleUri(uri);
      },
    }),

    vscode.commands.registerCommand("mnemoverse.signIn", async () => {
      try {
        await signIn(context, fireServerChanged);
      } catch (err) {
        await showCommandError("Failed to sign in to Mnemoverse", err);
      }
    }),

    vscode.commands.registerCommand("mnemoverse.signOut", async () => {
      try {
        await signOut(context, fireServerChanged);
      } catch (err) {
        await showCommandError("Failed to sign out of Mnemoverse", err);
      }
    }),

    vscode.commands.registerCommand("mnemoverse.setApiKey", async () => {
      try {
        // Force re-prompt by clearing first. Used when the user wants to
        // rotate their key or switch accounts without reinstalling.
        await clearApiKey(context);
        const key = await getApiKey(context);
        if (key) {
          fireServerChanged();
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
        fireServerChanged();
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

  // First-run welcome: if no key is stored and we have never shown it, offer
  // the one-click keyless Sign In. `peekApiKey` never prompts, so this cannot
  // pop a paste box. The flag is persisted BEFORE the toast so it shows once
  // ever — a dismissed welcome is not re-shown on the next launch (the
  // agent-touch path in provider.ts still catches an unconnected user when
  // they actually reach for memory). Fire-and-forget: activation never blocks
  // on a toast.
  void (async () => {
    try {
      const hasKey = !!(await peekApiKey(context));
      const shownBefore = context.globalState.get<boolean>(WELCOME_SHOWN_KEY, false);
      // Skip if a connect toast already fired this session (the provider's
      // agent-touch path may have raced ahead) — avoids a double toast. We
      // leave the persisted flag UNSET in that case, so the welcome still gets
      // its one-time turn on a later session.
      if (!shouldShowWelcome(hasKey, shownBefore) || wasConnectPromptShown()) {
        return;
      }
      await context.globalState.update(WELCOME_SHOWN_KEY, true);
      await promptConnect(
        "Welcome to Mnemoverse. Connect your memory to use it in Copilot Chat — no API key to paste.",
      );
    } catch (err) {
      console.error("[mnemoverse] first-run welcome failed:", err);
    }
  })();
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
 * UI text is kept generic (title only) so internal `Error.message`
 * content (which may reference SDK internals, paths, or other details)
 * never reaches the user-facing toast. Full detail goes to the
 * developer console via `console.error` — visible in the Extension Host
 * log for contributors reproducing an issue and in user-submitted bug
 * reports when we ask them to run the `Developer: Toggle Developer Tools`
 * command.
 */
async function showCommandError(
  title: string,
  err: unknown,
): Promise<void> {
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`[mnemoverse] ${title}: ${detail}`);
  await vscode.window.showErrorMessage(title);
}