import * as vscode from "vscode";
import { getApiKey } from "./auth";

/**
 * Must match the `id` field in `package.json` → `contributes.mcpServerDefinitionProviders`.
 */
const PROVIDER_ID = "mnemoverse.memory";

/**
 * Register the Mnemoverse Memory MCP server with VS Code's language-model
 * runtime. This is the canonical 2026 replacement for writing a
 * `.vscode/mcp.json` file: the Provider API lets our extension tell VS Code
 * "here's an MCP server, here's how to start it" at runtime, with no config
 * file ever touching the user's disk.
 *
 * Three methods on the provider interface:
 *
 *   - `onDidChangeMcpServerDefinitions`: fire when our list of definitions
 *     changes (e.g. the user enabled a second server). We return a single
 *     static definition, so the emitter never fires in v0.1.0.
 *   - `provideMcpServerDefinitions`: return the list WITHOUT secrets. VS Code
 *     displays these in its MCP server picker.
 *   - `resolveMcpServerDefinition`: called right before VS Code spawns the
 *     server. THIS is where we inject the API key from SecretStorage into the
 *     env map, after prompting the user if they haven't entered one yet.
 *
 * Returning a `Disposable` lets `extension.ts` add it to `context.subscriptions`
 * so the provider unregisters cleanly when the extension deactivates.
 */
export function registerProvider(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const didChangeEmitter = new vscode.EventEmitter<void>();
  const version = context.extension.packageJSON.version as string;

  return vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
    onDidChangeMcpServerDefinitions: didChangeEmitter.event,

    provideMcpServerDefinitions: async () => {
      // `@latest` on the end of the identifier matches what we ship in
      // `src/configs/source.json` of mcp-memory-server — ensures users pick
      // up new releases automatically whenever VS Code restarts the server.
      return [
        new vscode.McpStdioServerDefinition(
          "Mnemoverse Memory",
          "npx",
          ["-y", "@mnemoverse/mcp-memory-server@latest"],
          {
            // Placeholder; real value injected in resolveMcpServerDefinition.
            // Using empty string (not undefined) so the env map is populated
            // and the TS type check is happy.
            MNEMOVERSE_API_KEY: "",
          },
          version,
        ),
      ];
    },

    resolveMcpServerDefinition: async (server) => {
      if (server instanceof vscode.McpStdioServerDefinition) {
        const apiKey = await getApiKey(context);
        if (!apiKey) {
          // User cancelled the prompt. Refuse to start the server so VS
          // Code shows an explicit error in the chat instead of silently
          // failing with a 401 from core.mnemoverse.com. The user can run
          // `Mnemoverse: Set API Key` from the command palette to try again.
          throw new Error(
            'Mnemoverse API key required. Run "Mnemoverse: Set API Key" from the command palette to enter one.',
          );
        }
        server.env.MNEMOVERSE_API_KEY = apiKey;
      }
      return server;
    },
  });
}
