import * as vscode from "vscode";
import { peekApiKey } from "./auth";
import { promptConnect } from "./prompts";
import { SIGN_IN_REQUIRED_MESSAGE } from "./signin-core";

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
 *     into the env map. It reads the key WITHOUT prompting (`peekApiKey`):
 *     if none is stored we throw a "Sign In" error and surface a one-click
 *     connect toast, routing the user into the keyless flow rather than
 *     popping a paste box for a key they do not have.
 *
 * Both methods accept a `CancellationToken` parameter that VS Code uses
 * to abort long-running work during shutdown or rapid activation. We
 * honour it at the top of `resolveMcpServerDefinition`.
 *
 * Returning a `Disposable` lets `extension.ts` add it to
 * `context.subscriptions` so the provider unregisters cleanly when the
 * extension deactivates.
 */
export function registerProvider(
  context: vscode.ExtensionContext,
  onDidChangeServerDefinitions?: vscode.Event<void>,
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
    // Fired by extension.ts after a successful sign-in / sign-out so VS Code
    // re-runs resolveMcpServerDefinition and respawns the server with the new
    // (or cleared) key — without it the user would have to restart the server
    // manually after signing in. Owned + disposed by extension.ts (the emitter
    // lives in context.subscriptions), so registering its event here leaks
    // nothing across activations.
    onDidChangeMcpServerDefinitions: onDidChangeServerDefinitions,

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

      // Read-only — must NOT prompt here. A paste box from resolve would
      // bypass the keyless Sign In (the headline of v0.2.0) on the most
      // common first touch: a Copilot agent reaching for a memory tool.
      const apiKey = await peekApiKey(context);
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      if (!apiKey) {
        // No key stored. Refuse to start the server so VS Code shows an
        // explicit error in Copilot Chat instead of silently 401-ing against
        // core.mnemoverse.com — and surface a one-click "Sign In" toast that
        // routes the user into the keyless flow. promptConnect self-guards
        // (claimConnectPrompt) so this shows at most once per session even
        // though resolve can fire repeatedly; the thrown error still surfaces
        // on every resolve.
        void promptConnect();
        throw new Error(SIGN_IN_REQUIRED_MESSAGE);
      }

      // `server.env` defaults to `{}` when the constructor is called
      // without an env argument, so the assignment is always safe.
      server.env.MNEMOVERSE_API_KEY = apiKey;
      return server;
    },
  });
}
