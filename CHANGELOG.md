# Changelog

All notable changes to the Mnemoverse Memory extension for VS Code.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — Unreleased

Support for the editors that install the extension from Open VSX, not only
VS Code: Cursor gets a registered server, editors without an extension API get a
config snippet, and the extension says "connected" only when it registered
something.

### Added

- **Cursor support.** Cursor ignores VS Code's MCP provider API (its
  `registerMcpServerDefinitionProvider` is a stub that does nothing), so in
  Cursor the extension registers Mnemoverse's hosted server,
  `https://mcp.mnemoverse.com/mcp`, through Cursor's own
  `vscode.cursor.mcp.registerServer`. It appears as `extension-mnemoverse` in
  Cursor Settings → Tools & MCPs, where Cursor runs the sign-in. No headers and
  no key are passed. If `~/.cursor/mcp.json` or a workspace `.cursor/mcp.json`
  already has a Mnemoverse entry (hosted URL or the npm package), the extension
  adds nothing, so tools are not listed twice. Those files are only read.
- **Setup guidance for editors without a usable extension API** — Kiro,
  Windsurf / Devin Desktop, Trae, Antigravity, and any editor without
  `vscode.lm`: one first-run notice saying so, with **Copy config** and
  **Open guide**. New command `Mnemoverse: Copy MCP Config` copies a snippet for
  the hosted server in the editor's format (`url` or `serverUrl`, `mcpServers` or
  VS Code's `servers`) and names the file to paste it into. No config file is
  written.
- **Hosted connection** for VS Code-family editors: setting
  `mnemoverse.connection` (`local` by default, or `hosted`). `hosted` registers an
  HTTP server for `https://mcp.mnemoverse.com/mcp`; VS Code runs the MCP OAuth
  sign-in itself, nothing is spawned, and no Node.js or stored key is needed.
  Commands `Use Hosted Connection (no Node.js)` / `Use Local Connection (npx)`.
  Changing the setting swaps the server without a reload.
- **Node.js check** for the local connection: after a successful sign-in and
  before each server start, the extension looks for `npx` on PATH (with PATHEXT
  on Windows). If it is missing, the server start fails with "Mnemoverse's local
  server needs Node.js 18+ (npx was not found on PATH)" and one notice per
  session offers **Use hosted connection** or **Install Node.js**.
- **Status bar item** "Mnemoverse" with the current state (Connected / Sign in /
  Added to Cursor / Set up needed) and a menu of the actions that apply to the
  editor. Setting `mnemoverse.showStatusBar` hides it.
- **"Mnemoverse" output channel** (`Mnemoverse: Show Log`): host detection, the
  adapter chosen, what was registered, and errors. Keys and sign-in codes are
  never logged.
- **Walkthrough** "Get started with Mnemoverse Memory" (`Mnemoverse: Get
  Started`): connect (a different step for VS Code, Cursor and config-file
  editors), try it (`Mnemoverse: Try It in Chat` opens agent chat with a first
  prompt filled in), share a room.
- **Chat skill** `mnemoverse-memory` (VS Code 1.109+, offered once memory is
  connected): when to recall, what to save and never save, rating recalls with
  `memory_feedback`, rooms by address, and when to prefer Mnemoverse over the
  editor's local `/memories` notes. Older editors ignore it.
- **Rating prompt**: at most twice ever, only for a connected user after 7 days
  and 4 active days, never in a session that showed a setup notice. It links the
  review page of the store the editor uses (VS Code Marketplace or Open VSX).
  Commands `Rate Mnemoverse` and `Star on GitHub`.
- Commands `Open MCP Settings` and `Show Menu`.

### Changed

- **Host-aware text.** Notices name the editor (`vscode.env.appName`) instead of
  "VS Code" or "Copilot Chat", and the key minted by Sign In is named after the
  editor (for example "Cursor — host — date") in the console.
- **"Connected" means connected.** The extension says so only when it actually
  registered a server the editor will use. In Cursor, Sign In / Complete sign-in
  now explain Cursor's own sign-in instead of minting a key Cursor would never
  use; Set API Key explains first that Cursor doesn't use the key. On config-file
  editors, Sign In shows the Copy config guidance.
- **Sign-in wait is 30 minutes** (was 10). The portal's code lifetime starts when
  the code is created, after the user approves, so new users who sign up first
  could run out the old timer. The timeout notice now has **Try again** and
  **Paste key**.
- **Sign Out** says the key stays valid until it is revoked in the console, with
  an **Open console** button.
- The local server now starts with `MNEMOVERSE_CLIENT=vscode-extension`, so it can
  word its errors for extension users.

### Fixed

- Activation no longer fails as a whole when the editor has no `vscode.lm` or
  the provider registration throws: the URI handler and every command register
  first, and the MCP setup falls back to guidance. Before, every command failed
  with "command not found" in such editors.
- Eclipse Theia: the server started without a key, because Theia calls resolve
  without a cancellation token and with a plain object. Resolve now accepts both.
- `Set API Key` cleared the stored key before prompting, so pressing Escape
  signed the user out silently. It now prompts first and replaces the key only
  on a valid entry.
- A sign-in approved in the browser after the wait expired was dropped without a
  word. It now shows "This sign-in finished after the request expired — run
  Sign In again" with a **Sign In** button.

## [0.2.1] — 2026-09-23

Listing text only: the extension, its commands and its sign-in are unchanged.

### Changed

- **Marketplace and Open VSX description** now matches the product: memory that
  learns from outcomes (feedback re-ranks recall), with shared rooms, the same
  memory across Claude, Cursor and ChatGPT, one browser sign-in. The June text
  named only Copilot and said nothing about outcomes or rooms.
- **Keywords** add `mcp-server`, `github-copilot`, `long-term-memory`,
  `agent-memory`, `claude`, `cursor`, `chatgpt` and `memory-rooms`, the terms
  people search the Marketplace by.
- **README**: the tool table no longer lists `memory_delete` and
  `memory_delete_domain` (deletion is an administrative REST operation, not a
  tool of the server this extension launches) and drops the fixed "six tools";
  it adds `memory_list_recent` and the four room tools, and links the server's
  complete tool list.

## [0.2.0] — 2026-06-12

Keyless browser sign-in. First-run is now **install → "Mnemoverse: Sign In" →
browser → done** — the user never sees or pastes an API key. The paste flow
remains as a fallback.

### Added

- `Mnemoverse: Sign In` command. Opens `console.mnemoverse.com/connect/vscode`
  in the browser; after the user approves, the console mints a key, seals it
  under a one-time code, and hands it back via a `vscode://` callback. The
  extension exchanges the code (PKCE S256) for the key over HTTPS and stores it
  in SecretStorage — the same slot the MCP provider already reads, so the
  server respawns with the new key automatically.
- `Mnemoverse: Complete sign-in` command — manual fallback for when the browser
  can't return the code automatically (no `vscode://` handler, remote/SSH, a
  browser that blocks custom schemes): the consent page shows the one-time code,
  the user pastes it here, and it's redeemed against the in-flight PKCE verifier.
- `Mnemoverse: Sign Out` command — clears the stored key and re-resolves the server.
- First-run welcome and an in-context connect prompt: a one-time welcome
  notification on first activation, and a one-click **Sign In** toast the moment
  a Copilot agent reaches for a memory tool without a stored key. Both route into
  the keyless browser flow — the connect step stays human-confirmed; the toast
  only opens the door. A per-session guard shows at most one connect toast per
  window (welcome and agent-touch never double up); a deliberate Sign Out re-arms
  it.

### Changed

- `Set API Key` retitled to `Set API Key (paste manually)` — the manual path is
  now the fallback, not the primary.
- The MCP provider's resolve path now reads the key **without prompting**
  (`peekApiKey`) and, when none is stored, fails with a "Run Mnemoverse: Sign In"
  error instead of popping the manual paste input box. Previously the most
  common first touch — an agent using a memory tool before sign-in — bypassed
  the keyless flow entirely and asked the user to paste a key they didn't have.
- Key storage now goes through a single `mk_live_`-format guard on both the
  sign-in and paste paths, so a malformed key can never be persisted.

### Security

- One-time code is 256-bit, single-use, 10-min TTL, PKCE-bound; the raw key
  never appears in a URL, a log, or the callback. Exchange responses are
  schema-validated before the key is trusted.

## [0.1.1] — 2026-04-13

Self-review patch. v0.1.0 shipped to both registries within ~10 minutes
of the first tag push and immediately surfaced a handful of real bugs
plus a misleading README scope claim via Copilot's auto-review and a
three-agent internal audit. No users were affected (v0.1.0 had zero
installs at publish time), but shipping early plus reviewing hard is
the whole point of v0.1.x. A second Copilot pass on the patch PR itself
caught five more minor issues, all folded into this release.

### Fixed

- `provider.ts`: `provideMcpServerDefinitions` and
  `resolveMcpServerDefinition` now accept the `CancellationToken`
  parameter declared in the `McpServerDefinitionProvider` interface.
  `resolveMcpServerDefinition` now throws `vscode.CancellationError`
  when the token fires (instead of returning the unresolved
  definition) so a shutdown-during-activation race can no longer
  cause VS Code to spawn the server with a missing API key and
  surface a confusing 401 from core.mnemoverse.com.
- `provider.ts`: `McpStdioServerDefinition.version` is now tied to the
  extension version (read at runtime from `package.json`) instead of
  the literal string `"latest"`. VS Code uses this field as a cache
  key for the server's tool list — a fixed string meant the cache
  would never refresh even when a new extension release shipped a
  behavioural change. Tying it to the extension version means every
  patch release forces a clean tool-list refresh in the editor.
- `provider.ts`: replaced the unused `EventEmitter<void>` with omission
  of the optional `onDidChangeMcpServerDefinitions` field. Our
  definition list is static at runtime; earlier versions leaked a
  Disposable on every activation.
- `provider.ts`: dropped the placeholder `MNEMOVERSE_API_KEY: ""`
  entry from the unresolved `McpStdioServerDefinition.env`. The real
  key is now materialised only in `resolveMcpServerDefinition`, so
  nothing secret-shaped ever appears in the definition a debugger or
  other extension might snapshot.
- `extension.ts`: every command handler is now wrapped in a
  `try/catch` that surfaces failures via `showErrorMessage`. Without
  this, rejections from `SecretStorage.store()` (keychain locked) or
  `env.openExternal` (no default browser) were silently swallowed by
  the command runner and the palette entry appeared to do nothing.
  The user-facing toast deliberately shows only a generic title —
  full error detail (including any SDK internals in `Error.message`)
  is logged to `console.error` so it reaches the Extension Host log
  without leaking into the UI.

### Changed

- `README.md`: rewrote the scope section to be honest about what this
  extension does. The earlier copy implied the extension itself runs
  everywhere across Claude / Cursor / ChatGPT, which misled users on
  other editors. The new copy makes explicit that this extension
  wires Mnemoverse into GitHub Copilot Chat Agent Mode on VS Code
  1.102+, and points Cursor / Windsurf / Claude / ChatGPT / REST
  users at their respective setup pages for the same memory account.
- `package.json`:
  - `publisher` is now `Mnemoverse` (capitalised) to match the
    canonical casing stored in the Marketplace after first publish.
    Our lowercase was case-insensitively matched at publish time but
    any future tooling that greps on the exact publisher string would
    break on the mismatch.
  - `preview: true` — v0.1.x is pre-stable and the Marketplace should
    show the Preview banner.
  - `pricing: "Free"` — explicit rather than implicit.
  - `sponsor.url` — points at `github.com/sponsors/mnemoverse`.
  - `extensionKind: ["ui"]` — the extension must run on the local
    UI-side extension host so that `npx` spawns on the user's own
    machine and `SecretStorage` reads from the local OS keychain.
    The earlier `"workspace"` value would have made VS Code run the
    extension on the remote extension host in Remote-SSH / Codespaces
    sessions, where `npx` would resolve against the remote node_modules
    and `SecretStorage` would point at a different keychain — the exact
    opposite of our intent. Copilot's review on the v0.1.1 PR caught
    this.
  - `capabilities.untrustedWorkspaces: { supported: false }` and
    `capabilities.virtualWorkspaces: { supported: false }` — both
    required for anything that runs arbitrary third-party code via
    `npx`. Without these declarations VS Code shows an unexpected
    trust dialog on activation. The `virtualWorkspaces` description
    now explicitly names `github.dev` and `vscode.dev` as the
    unsupported environments (the flag is about virtual workspaces
    only, not Remote-SSH).
  - `galleryBanner` — dark navy brand colour on the Marketplace hero.
  - Keyword list trimmed to the actually relevant ones: dropped
    `claude`, `cursor`, `vscode`, `chatgpt` (the extension itself
    does not integrate with those) and added `copilot`,
    `copilot-chat`, `agent-mode` (which it does).
- Command titles: dropped the redundant `Mnemoverse: ` prefix from
  `title` since VS Code already renders the `category` name (which
  is `Mnemoverse`) as a separate column in the command palette.

### Added

- `.vscode/launch.json` and `.vscode/tasks.json` — `F5` in the repo
  now launches an Extension Development Host window against the
  current source, with a build task configured for `npm: compile`.
  Local dev UX for first-time contributors.
- `.github/SECURITY.md` — coordinated disclosure contact, pointing
  at `security@mnemoverse.com` and the repo's private advisory URL.
- `.github/FUNDING.yml` — sponsor links (GitHub Sponsors, console).

## [0.1.0] — 2026-04-13

First public release.

### Added

- Registers `@mnemoverse/mcp-memory-server` as an MCP server via the
  VS Code `registerMcpServerDefinitionProvider` API (requires
  VS Code ≥ 1.102).
- API key paste flow via `vscode.window.showInputBox` → stored in
  `vscode.SecretStorage` (OS keychain, never on disk).
- Three commands: `Mnemoverse: Set API Key`,
  `Mnemoverse: Clear API Key`, `Mnemoverse: Open Documentation`.
- Zero config files created — no `.vscode/mcp.json`, no workspace
  pollution. The extension is the config.
- Works in GitHub Copilot Chat Agent Mode. Once active, the
  `memory_write`, `memory_read`, `memory_feedback`, `memory_stats`,
  `memory_delete`, and `memory_delete_domain` tools become available
  to the agent.

### Not yet in this release

- OAuth 2.0 sign-in flow. Deferred to a later release after the
  Mnemoverse Remote MCP server ships at `mcp.mnemoverse.com`.
- Status bar connection indicator.
- Welcome notification on first activation.
- Screenshots / GIFs in the Marketplace README.
