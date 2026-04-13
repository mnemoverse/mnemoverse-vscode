# Changelog

All notable changes to the Mnemoverse Memory extension for VS Code.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-04-13

Self-review patch. v0.1.0 shipped to both registries within ~10 minutes
of the first tag push and immediately surfaced a handful of real bugs
plus a misleading README scope claim via Copilot's auto-review and a
three-agent internal audit. No users were affected (v0.1.0 had zero
installs at publish time), but shipping early plus reviewing hard is
the whole point of v0.1.x.

### Fixed

- `provider.ts`: `provideMcpServerDefinitions` and
  `resolveMcpServerDefinition` now accept the `CancellationToken`
  parameter declared in the `McpServerDefinitionProvider` interface.
  `resolveMcpServerDefinition` also checks `token.isCancellationRequested`
  before and after the API-key prompt so a shutdown-during-activation
  race no longer leaks a pending `showInputBox`.
- `provider.ts`: replaced the unused `EventEmitter<void>` with omission
  of the optional `onDidChangeMcpServerDefinitions` field. Our
  definition list is static at runtime; earlier versions leaked a
  Disposable on every activation.
- `provider.ts`: dropped the placeholder `MNEMOVERSE_API_KEY: ""`
  entry from the unresolved `McpStdioServerDefinition.env`. The real
  key is now materialised only in `resolveMcpServerDefinition`, so
  nothing secret-shaped ever appears in the definition a debugger or
  other extension might snapshot.
- `provider.ts`: `McpStdioServerDefinition.version` now passes the
  literal string `"latest"` instead of the extension's package.json
  version. The field represents the server's version for cache
  invalidation, not the extension's — passing the extension version
  was misleading for diagnostics.
- `extension.ts`: every command handler is now wrapped in a
  `try/catch` that surfaces failures via `showErrorMessage`. Without
  this, rejections from `SecretStorage.store()` (keychain locked) or
  `env.openExternal` (no default browser) were silently swallowed by
  the command runner and the palette entry appeared to do nothing.

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
  - `extensionKind: ["workspace"]` — we only run local (spawn `npx`),
    so we declare it to avoid VS Code offering us for Remote
    Development scenarios where we would silently fail.
  - `capabilities.untrustedWorkspaces: { supported: false }` and
    `capabilities.virtualWorkspaces: { supported: false }` — both
    required for anything that runs arbitrary third-party code via
    `npx`. Without these declarations VS Code shows an unexpected
    trust dialog on activation.
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
