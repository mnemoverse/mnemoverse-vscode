# Changelog

All notable changes to the Mnemoverse Memory extension for VS Code.
The format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-04-13

First public release.

### Added
- Registers `@mnemoverse/mcp-memory-server` as an MCP server via the VS Code
  `registerMcpServerDefinitionProvider` API (requires VS Code ≥ 1.102).
- API key paste flow via `vscode.window.showInputBox` → stored in
  `vscode.SecretStorage` (OS keychain, never on disk).
- Three commands: `Mnemoverse: Set API Key`, `Mnemoverse: Clear API Key`,
  `Mnemoverse: Open Documentation`.
- Zero config files created — no `.vscode/mcp.json`, no workspace pollution.
  The extension is the config.
- Works in GitHub Copilot Chat Agent Mode. Once active, the `memory_write`,
  `memory_read`, `memory_feedback`, `memory_stats`, `memory_delete`, and
  `memory_delete_domain` tools become available to the agent.

### Not yet in this release
- OAuth 2.0 sign-in flow. Deferred to v0.2.x after the Mnemoverse Remote MCP
  server ships at `mcp.mnemoverse.com`.
- Status bar connection indicator.
- Welcome notification on first activation.
