import * as vscode from "vscode";
import { registerProvider } from "./provider";
import { clearApiKey, getApiKey } from "./auth";

/**
 * Extension entry point. Called by VS Code after activation
 * (`activationEvents: ["onStartupFinished"]` in package.json).
 *
 * Three things happen here:
 *
 *   1. Register the MCP server definition provider. VS Code's Copilot Chat
 *      Agent Mode will call into it whenever the user spawns our server.
 *   2. Register three commands (Set / Clear / Open Docs) so the user can
 *      manage their API key and jump to documentation from the command
 *      palette without leaving VS Code.
 *   3. Push every registration into `context.subscriptions` so VS Code
 *      cleans them up when the extension deactivates.
 *
 * v0.1.0 deliberately has NO status bar, NO welcome notification, NO
 * OAuth. Those are v2 work that slots in after Phase 2 (Remote MCP server)
 * without changing the provider wiring.
 */
export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    registerProvider(context),

    vscode.commands.registerCommand("mnemoverse.setApiKey", async () => {
      // Force re-prompt by clearing first. Used when the user wants to
      // rotate their key or switch accounts without reinstalling.
      await clearApiKey(context);
      const key = await getApiKey(context);
      if (key) {
        void vscode.window.showInformationMessage("Mnemoverse API key saved.");
      }
    }),

    vscode.commands.registerCommand("mnemoverse.clearApiKey", async () => {
      await clearApiKey(context);
      void vscode.window.showInformationMessage("Mnemoverse API key cleared.");
    }),

    vscode.commands.registerCommand("mnemoverse.openDocs", async () => {
      await vscode.env.openExternal(
        vscode.Uri.parse("https://mnemoverse.com/docs/api/mcp-server"),
      );
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond the disposables in context.subscriptions.
  // VS Code handles those automatically.
}
