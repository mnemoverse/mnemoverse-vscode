# Mnemoverse Memory for VS Code

> Persistent memory for GitHub Copilot Chat Agent Mode — one API key, every AI tool.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/Mnemoverse.mnemoverse-vscode?label=VS%20Code%20Marketplace&color=0098ff)](https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/mnemoverse/mnemoverse-vscode?label=Open%20VSX&color=c160ef)](https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode)
[![npm](https://img.shields.io/npm/v/@mnemoverse/mcp-memory-server.svg?color=cb3837&label=mcp%20server)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-0ea5e9)](https://registry.modelcontextprotocol.io/v0.1/servers?search=mnemoverse)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## What this extension does

**Adds Mnemoverse Memory as an MCP server inside GitHub Copilot Chat's Agent Mode**, with no `.vscode/mcp.json` file to edit and no JSON config to commit. Once installed and given an API key, your Copilot agent gains six tools for long-term memory: it can store facts, preferences, and decisions during one chat and recall them from any future chat — across sessions, branches, and projects.

### Scope (honest)

This specific extension wires Mnemoverse into **GitHub Copilot Chat Agent Mode on VS Code 1.102 or newer**. That's currently the only chat client in the VS Code ecosystem that consumes MCP servers registered via the native `vscode.lm` API.

If you use a different editor / client, install Mnemoverse there directly — the memory is the same account, the setup is different:

| Client | Mode | How to install Mnemoverse |
| ------ | ---- | ------------------------- |
| **VS Code + Copilot Chat** | Agent Mode | **This extension** (1-click from Marketplace) |
| **VS Code + Copilot Chat** | Ask / Edit Mode | Not supported — MCP servers only run in Agent Mode |
| **Cursor** | built-in chat | [`.cursor/mcp.json` snippet](https://mnemoverse.com/docs/api/editors) |
| **Windsurf** | built-in chat | [`~/.codeium/windsurf/mcp_config.json` snippet](https://mnemoverse.com/docs/api/editors) |
| **Claude Code** | CLI | [`claude mcp add` one-liner](https://mnemoverse.com/docs/api/claude) |
| **Claude Desktop** | app | [`claude_desktop_config.json` snippet](https://mnemoverse.com/docs/api/claude) |
| **ChatGPT** | Custom GPT | [GPT Actions + OAuth](https://mnemoverse.com/docs/api/chatgpt) |
| **Any HTTP client** | — | [REST API](https://mnemoverse.com/docs/api/reference) |

Write a memory in any of the tools above → read it from any other. **Same Mnemoverse account, same memory layer, different integration plumbing per client.**

## Requirements

- **VS Code 1.102** or newer — required for the `registerMcpServerDefinitionProvider` API this extension uses
- **GitHub Copilot Chat** extension installed and signed in
- A free **Mnemoverse API key** — sign up at [console.mnemoverse.com](https://console.mnemoverse.com), no credit card
- **Node.js** on your PATH — the extension spawns `npx` to run the memory server

## Install

1. Search for **"Mnemoverse Memory"** in the VS Code Marketplace and click **Install**.
2. Open Copilot Chat (`Cmd/Ctrl+Shift+I`) and switch the mode picker to **Agent**. MCP servers only show there.
3. Ask the agent to remember something. On first run VS Code will prompt you for an API key — paste yours and it's stored in the OS keychain, never on disk.

You can also run the `Mnemoverse: Set API Key` command from the palette to enter your key up front.

## Try it

In a Copilot Chat Agent Mode session:

> Remember that I prefer Railway for deployments.

Open a **new chat** and ask:

> Where should I deploy this?

If Copilot recalls Railway, everything is wired up. The memory persists across sessions, machines with the same account, and every other Mnemoverse-connected tool.

## Tools exposed to the agent

| Tool | What it does |
| ---- | ------------ |
| `memory_write` | Store a preference, decision, or lesson |
| `memory_read` | Search memories by natural-language query |
| `memory_feedback` | Rate a memory as helpful or harmful (affects future retrieval) |
| `memory_stats` | Show total memories, domains, and average importance |
| `memory_delete` | Permanently delete one memory by id |
| `memory_delete_domain` | Wipe an entire domain (safety interlocked) |

## Commands

| Command | What it does |
| ------- | ------------ |
| `Mnemoverse: Set API Key` | Enter or rotate your API key. Clears any existing one first. |
| `Mnemoverse: Clear API Key` | Remove the stored API key. Next server start re-prompts. |
| `Mnemoverse: Open Documentation` | Open the docs in your default browser. |

## How it works (internals)

This extension uses `vscode.lm.registerMcpServerDefinitionProvider` — the canonical 2026 path for third-party MCP server integration in VS Code. It contributes an entry to VS Code's Language Model namespace rather than writing a `.vscode/mcp.json` file in your workspace. No config files are created.

When Copilot Chat Agent Mode calls into our provider's `resolveMcpServerDefinition`, we pull your API key from `vscode.SecretStorage` (OS keychain) and spawn `npx -y @mnemoverse/mcp-memory-server@latest` with the key in the child process environment. The `@latest` tag ensures you automatically get new releases of the underlying [mcp-memory-server](https://github.com/mnemoverse/mcp-memory-server) npm package — same binary our docs point Claude Desktop and Cursor users at, same open-source implementation.

The server itself is a thin stdio wrapper that forwards tool calls to `core.mnemoverse.com/api/v1` over HTTPS. The API key never leaves your machine for any purpose except authenticating API calls to Mnemoverse.

## Privacy and security

- Your API key is stored only in `vscode.SecretStorage` (OS keychain — macOS Keychain, Windows Credential Vault, Linux libsecret). Never on disk, never in settings.json, never in git.
- The extension contains zero telemetry of its own.
- Memory content is sent to `core.mnemoverse.com` over HTTPS. See the [Mnemoverse privacy policy](https://mnemoverse.com/legal/privacy-policy) for what is stored and for how long.
- Capabilities declared in `package.json`: `untrustedWorkspaces: false` (we spawn `npx`, which runs arbitrary third-party code), `virtualWorkspaces: false` (we need a local Node.js runtime).

### Security disclosures

Found a vulnerability? Contact [security@mnemoverse.com](mailto:security@mnemoverse.com) or file a private advisory at [github.com/mnemoverse/mnemoverse-vscode/security/advisories/new](https://github.com/mnemoverse/mnemoverse-vscode/security/advisories/new). Coordinated disclosure policy: [mnemoverse.com/.well-known/security.txt](https://mnemoverse.com/.well-known/security.txt).

## Source

MIT licensed: [github.com/mnemoverse/mnemoverse-vscode](https://github.com/mnemoverse/mnemoverse-vscode). Contributions welcome.
