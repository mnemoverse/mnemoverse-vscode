import * as vscode from "vscode";
import { peekApiKey } from "./auth";
import { promptConnect } from "./prompts";
import { SIGN_IN_REQUIRED_MESSAGE } from "./signin-core";
import { HOSTED_MCP_URL } from "./hosts";
import { getConnectionMode } from "./state";
import { isNpxAvailable, promptNodeMissing, NODE_MISSING_MESSAGE } from "./node-check";

/**
 * Must match the `id` field in `package.json` →
 * `contributes.mcpServerDefinitionProviders` (a test holds them together).
 */
export const PROVIDER_ID = "mnemoverse.memory";

/** Label shown in the editor's MCP server list, for both connection modes. */
export const SERVER_LABEL = "Mnemoverse Memory";

/**
 * The `lm` adapter: register the Mnemoverse Memory MCP server with VS Code's
 * language-model runtime. This is the stable replacement for writing a
 * `.vscode/mcp.json` file: the Provider API lets the extension tell the editor
 * "here's an MCP server, here's how to start it" at runtime, with no config
 * file ever touching the user's disk.
 *
 * Used only on hosts where hosts.ts decided the provider is honoured (VS Code,
 * Insiders, VSCodium, Positron, Theia, code-oss, unknown forks). Cursor and the
 * other known no-op hosts never get here.
 *
 * Two connection modes, from the `mnemoverse.connection` setting:
 *
 *   - `local` (default) — a stdio server: `npx -y @mnemoverse/mcp-memory-server@latest`
 *     with the key from the keyless Sign In injected at resolve time. Needs
 *     Node.js 18+ on PATH.
 *   - `hosted` — an HTTP server at https://mcp.mnemoverse.com/mcp. The editor
 *     runs the MCP OAuth flow itself (401 → protected-resource metadata →
 *     dynamic client registration → browser consent), so the extension stores
 *     no key and spawns nothing. The hosted server accepts only its own OAuth
 *     tokens, not mk_live keys, which is why no header is passed.
 *
 * Changing the setting fires `onDidChangeMcpServerDefinitions` (extension.ts
 * listens for the configuration change), so the editor re-queries and swaps
 * the server without a reload.
 *
 * The methods of `McpServerDefinitionProvider`:
 *
 *   - `onDidChangeMcpServerDefinitions` — fired after sign-in / sign-out and on
 *     a connection-mode change, so the editor re-resolves and respawns.
 *
 *   - `provideMcpServerDefinitions(token)` — returns the list WITHOUT secrets.
 *     The API docs say this method must not take actions that need user
 *     interaction, such as authentication, so it never prompts.
 *
 *   - `resolveMcpServerDefinition(server, token)` — called right before the
 *     editor starts the server. For stdio it checks for npx, reads the key
 *     WITHOUT prompting (`peekApiKey`), and injects it into the env. If either
 *     is missing it throws a clear error and shows a one-click fix toast.
 *
 * THEIA (0.3.0). Eclipse Theia implements this API but calls resolve with ONE
 * argument (no token) and a plain object rebuilt from a DTO, not an instance
 * of `McpStdioServerDefinition`. The 0.2.x code read `token.isCancellationRequested`
 * (TypeError) and used `instanceof` (always false), so on Theia the server
 * started with no key. Hence: an optional token, a duck-typed stdio check, and
 * an env object created when the host omitted it.
 *
 * Throws if the host has no provider API at all; activate() catches that and
 * falls back to guidance mode.
 */
export function registerProvider(
  context: vscode.ExtensionContext,
  onDidChangeServerDefinitions?: vscode.Event<void>,
): vscode.Disposable {
  // `version` is the editor's cache key for the server's tool list — when it
  // changes, the editor re-fetches. The npx spec is `@latest`, so the real
  // server version is unknown until spawn; the extension version stands in,
  // read through the native API (no relative `require` of package.json).
  // Every extension release therefore forces a clean tool-list refresh. The
  // hosted definition gets its own suffix so a mode switch refreshes too.
  const extensionVersion: string =
    (context.extension?.packageJSON?.version as string | undefined) ?? "0.0.0";

  const lm = (vscode as unknown as { lm?: { registerMcpServerDefinitionProvider?: unknown } }).lm;
  if (typeof lm?.registerMcpServerDefinitionProvider !== "function") {
    throw new Error("vscode.lm.registerMcpServerDefinitionProvider is not available in this editor");
  }

  return vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
    // Owned + disposed by extension.ts (the emitter lives in
    // context.subscriptions), so registering its event here leaks nothing.
    onDidChangeMcpServerDefinitions: onDidChangeServerDefinitions,

    provideMcpServerDefinitions: async (
      _token?: vscode.CancellationToken,
    ): Promise<vscode.McpServerDefinition[]> => {
      if (getConnectionMode() === "hosted") {
        return [
          new vscode.McpHttpServerDefinition(
            SERVER_LABEL,
            vscode.Uri.parse(HOSTED_MCP_URL),
            undefined, // no headers: the editor's own OAuth supplies the bearer token
            `${extensionVersion}-hosted`,
          ),
        ];
      }
      // `@latest` matches the pin in mcp-memory-server's
      // `src/configs/source.json` — users pick up new releases whenever the
      // editor restarts the server.
      //
      // Env map intentionally omitted: the real MNEMOVERSE_API_KEY is injected
      // in resolve from SecretStorage, so nothing secret-shaped ever appears in
      // the unresolved definition that another extension or a debugger could
      // snapshot.
      return [
        new vscode.McpStdioServerDefinition(
          SERVER_LABEL,
          "npx",
          ["-y", "@mnemoverse/mcp-memory-server@latest"],
          undefined,
          extensionVersion,
        ),
      ];
    },

    resolveMcpServerDefinition: async (
      server: vscode.McpServerDefinition,
      token?: vscode.CancellationToken,
    ): Promise<vscode.McpServerDefinition> => {
      // On cancellation we MUST NOT return the unresolved definition — the
      // editor may still spawn the server without a key and surface a
      // confusing auth error. `CancellationError` is the documented way to
      // abort a resolve cleanly. `token?.`: Theia passes none.
      if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
      }

      // Hosted (HTTP) definitions pass through untouched: the editor's own
      // OAuth handles authentication, and we have nothing to inject.
      if (!isStdioDefinition(server)) {
        return server;
      }

      // Node first: without npx no key can help, and the toast offers the
      // hosted connection, which avoids the key step entirely.
      if (!isNpxAvailable()) {
        void promptNodeMissing();
        throw new Error(NODE_MISSING_MESSAGE);
      }

      // Read-only — must NOT prompt here. A paste box from resolve would
      // bypass the keyless Sign In on the most common first touch: an agent
      // reaching for a memory tool.
      const apiKey = await peekApiKey(context);
      if (token?.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      if (!apiKey) {
        // Refuse to start so the chat shows an explicit error instead of a
        // silent 401 — and surface a one-click Sign In toast. promptConnect
        // self-guards to once per session; the thrown error still surfaces on
        // every resolve.
        void promptConnect();
        throw new Error(SIGN_IN_REQUIRED_MESSAGE);
      }

      // A host may hand us a definition without an env map (Theia's DTO
      // rebuild); create one rather than assume the constructor default.
      server.env ??= {};
      server.env.MNEMOVERSE_API_KEY = apiKey;
      // Lets the server word its errors for extension users ("run Mnemoverse:
      // Sign In") instead of pointing at an MCP config file they don't have.
      server.env.MNEMOVERSE_CLIENT = "vscode-extension";
      return server;
    },
  });
}

/**
 * Stdio definitions carry a `command`; HTTP ones a `uri`. Duck-typed on purpose:
 * `instanceof vscode.McpStdioServerDefinition` is false for the plain objects
 * some hosts (Theia) pass to resolve.
 */
export function isStdioDefinition(
  server: vscode.McpServerDefinition,
): server is vscode.McpStdioServerDefinition {
  return typeof server === "object" && server !== null && "command" in server;
}
