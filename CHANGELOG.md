# Changelog

All notable changes to the Mnemoverse Memory extension for VS Code.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
- `Mnemoverse: Sign Out` command — clears the stored key and re-resolves the server.
- Anti-phishing visual code shown in the editor and on the consent page (derived
  from the request `state`), so a relay flow the user didn't start shows a
  different code.
- First-run welcome and an in-context connect prompt: a one-time
  "Connect Mnemoverse memory" notification on first activation, and a
  one-click **Sign In** toast the moment a Copilot agent reaches for a memory
  tool without a stored key. Both route into the keyless browser flow — the
  connect step stays human-confirmed; the toast only opens the door.

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
