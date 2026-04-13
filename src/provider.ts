import * as vscode from "vscode";
import { getApiKey } from "./auth";

/**
 * Must match the `id` field in `package.json` →
 * `contributes.mcpServerDefinitionProviders`.
 */
const PROVIDER_ID = "mnemoverse.memory";

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
  // VS Code uses `McpStdioServerDefinition.version` as a cache key for
  // the server's tool list — when it changes, the editor re-fetches.
  // Our spawn line is `npx -y @mnemoverse/mcp-memory-server@latest`, so
  // the actual running code is whatever `latest` resolves to at spawn
  // time; we can't read the real upstream version without spawning. We
  // tie the cache key to the *extension* version instead, read from
  // `context.extension.packageJSON` (the native VS Code API — no
  // relative `require` of package.json that would be fragile if the
  // vsix layout changes). Every extension release forces a clean
  // tool-list refresh. If the upstream server changes its tool surface
  // in a way users need to pick up, bump the extension patch version
  // and re-publish.
  const serverVersion: string =
    (context.extension?.packageJSON?.version as string | undefined) ??
    "0.0.0";

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
          serverVersion,
        ),
      ];
    },

    resolveMcpServerDefinition: async (
      server: vscode.McpServerDefinition,
      token: vscode.CancellationToken,
    ): Promise<vscode.McpServerDefinition> => {
      // On cancellation we MUST NOT return the unresolved definition —
      // VS Code may still spawn the server with an empty API key env
      // var, which would hit core.mnemoverse.com with a 401 and surface
      // a confusing auth error to the user. Throwing `CancellationError`
      // is the documented way to signal "abort this resolve cleanly".
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      if (!(server instanceof vscode.McpStdioServerDefinition)) {
        return server;
      }

      const apiKey = await getApiKey(context);
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
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
