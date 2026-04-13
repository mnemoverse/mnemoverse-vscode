import * as vscode from "vscode";
import { getApiKey } from "./auth";

/**
 * Must match the `id` field in `package.json` →
 * `contributes.mcpServerDefinitionProviders`.
 */
const PROVIDER_ID = "mnemoverse.memory";

/**
 * Version string passed to `McpStdioServerDefinition`. The VS Code API
 * uses this field for cache invalidation — whenever the string changes,
 * the editor re-fetches the tool list from the server and prompts the
 * user to refresh.
 *
 * Our spawn line is `npx -y @mnemoverse/mcp-memory-server@latest`, so the
 * actual running code is whatever `latest` resolves to at spawn time.
 * A fixed semver here would lie — "latest" is the honest answer. If we
 * want to force a refresh on a breaking upstream change, bump the
 * extension version and VS Code will reload on install of the new
 * extension release.
 */
const SERVER_VERSION = "latest";

/**
 * Register the Mnemoverse Memory MCP server with VS Code's language-model
 * runtime. This is the canonical 2026 replacement for writing a
 * `.vscode/mcp.json` file: the Provider API lets our extension tell
 * VS Code "here's an MCP server, here's how to start it" at runtime,
 * with no config file ever touching the user's disk.
 *
 * Three methods on `McpServerDefinitionProvider`:
 *
 *   - `onDidChangeMcpServerDefinitions` — OPTIONAL event we fire when our
 *     definition list changes. We return a single static definition that
 *     never changes at runtime, so we omit the field entirely. Earlier
 *     versions created an unused `EventEmitter` that leaked a Disposable
 *     across activations.
 *
 *   - `provideMcpServerDefinitions(token)` — required. Returns the list
 *     WITHOUT secrets. VS Code documentation explicitly says "extensions
 *     should not take actions which would require user interaction, such
 *     as authentication" in this method, so we do NOT prompt for the API
 *     key here.
 *
 *   - `resolveMcpServerDefinition(server, token)` — optional but we
 *     implement it. Called right before VS Code spawns the server. THIS
 *     is where we pull the API key from `SecretStorage` and inject it
 *     into the env map, prompting the user if they haven't entered one
 *     yet.
 *
 * Both methods accept a `CancellationToken` parameter that VS Code uses
 * to abort long-running work during shutdown or rapid activation. We
 * honour it at the top of `resolveMcpServerDefinition` (the prompt path
 * is the only slow part).
 *
 * Returning a `Disposable` lets `extension.ts` add it to
 * `context.subscriptions` so the provider unregisters cleanly when the
 * extension deactivates.
 */
export function registerProvider(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
    // `onDidChangeMcpServerDefinitions` is optional per the interface
    // (`readonly onDidChangeMcpServerDefinitions?: Event<void>;`) and
    // we have a static list, so we omit the field entirely.

    provideMcpServerDefinitions: async (
      _token: vscode.CancellationToken,
    ): Promise<vscode.McpServerDefinition[]> => {
      // `@latest` on the npm spec matches the pin we ship in
      // mcp-memory-server's `src/configs/source.json` — users pick up
      // new releases automatically whenever VS Code restarts the server.
      //
      // Env map intentionally omitted — the constructor default is `{}`,
      // and the real MNEMOVERSE_API_KEY is injected in
      // `resolveMcpServerDefinition` from SecretStorage. Nothing
      // secret-shaped ever appears in the unresolved definition that
      // might be snapshot-ed by a debugger or other extension.
      return [
        new vscode.McpStdioServerDefinition(
          "Mnemoverse Memory",
          "npx",
          ["-y", "@mnemoverse/mcp-memory-server@latest"],
          undefined,
          SERVER_VERSION,
        ),
      ];
    },

    resolveMcpServerDefinition: async (
      server: vscode.McpServerDefinition,
      token: vscode.CancellationToken,
    ): Promise<vscode.McpServerDefinition> => {
      if (token.isCancellationRequested) {
        return server;
      }
      if (!(server instanceof vscode.McpStdioServerDefinition)) {
        return server;
      }

      const apiKey = await getApiKey(context);
      if (token.isCancellationRequested) {
        return server;
      }
      if (!apiKey) {
        // User cancelled the API-key prompt. Refuse to start the server
        // so VS Code shows an explicit error in Copilot Chat instead of
        // silently failing with a 401 from core.mnemoverse.com. The user
        // can run `Mnemoverse: Set API Key` from the command palette to
        // try again.
        throw new Error(
          'Mnemoverse API key required. Run "Mnemoverse: Set API Key" from the command palette to enter one.',
        );
      }

      // `server.env` defaults to `{}` when the constructor is called
      // without an env argument, so the assignment is always safe.
      server.env.MNEMOVERSE_API_KEY = apiKey;
      return server;
    },
  });
}
