# Mnemoverse Memory for VS Code

> Persistent memory for AI coding assistants. One API key, every tool.

[![npm](https://img.shields.io/npm/v/@mnemoverse/mcp-memory-server.svg?color=cb3837&label=mcp%20server)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-0ea5e9)](https://registry.modelcontextprotocol.io/v0.1/servers?search=mnemoverse)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Shared AI memory across Claude, Cursor, ChatGPT, VS Code, and any MCP client. Write a fact once in any AI tool, recall it from any other — no copy-paste, no re-explaining your project every session.

## What this extension does

Installs [`@mnemoverse/mcp-memory-server`](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server) as a Model Context Protocol server in VS Code's Copilot Chat **Agent Mode**. Once active, your agent gains six tools:

| Tool | What it does |
| ---- | ------------ |
| `memory_write` | Store a preference, decision, or lesson |
| `memory_read` | Search memories by natural-language query |
| `memory_feedback` | Rate a memory as helpful or harmful |
| `memory_stats` | Show total memories, domains, average importance |
| `memory_delete` | Permanently delete one memory by id |
| `memory_delete_domain` | Wipe an entire domain (safety interlocked) |

## Requirements

- **VS Code 1.102** or newer (for the `registerMcpServerDefinitionProvider` API)
- **GitHub Copilot Chat** extension installed and signed in
- A **Mnemoverse API key** — free at [console.mnemoverse.com](https://console.mnemoverse.com), no credit card
- **Node.js** on your PATH (the extension spawns `npx` to run the server)

## Install

1. Install from the VS Code Marketplace: search for **"Mnemoverse Memory"**.
2. Open Copilot Chat and switch to **Agent Mode** (MCP servers only show there).
3. The first time the agent triggers a memory tool, VS Code will prompt you for an API key — paste yours and it's cached in the OS keychain.

Or from the command palette at any time, run **`Mnemoverse: Set API Key`** to enter your key up front.

## Try it

In a Copilot Chat Agent Mode conversation:

> "Remember that I prefer Railway for deployments"

Then in a new chat:

> "Where should I deploy this?"

Your agent will recall Railway, even though the two chats had no shared history. That's the point.

## How it works

This extension uses the canonical 2026 path for integrating a third-party MCP server: the `vscode.lm.registerMcpServerDefinitionProvider` API. It does **not** write a `.vscode/mcp.json` file in your workspace, does not touch your settings, and does not create any files. The extension itself is the configuration.

On first use, VS Code calls our provider's `resolveMcpServerDefinition`, which pulls your API key from `vscode.SecretStorage` (or prompts for it once) and spawns `npx -y @mnemoverse/mcp-memory-server@latest` with the key in the env. The actual memory tools are served by our open-source [mcp-memory-server](https://github.com/mnemoverse/mcp-memory-server) npm package, which talks to `core.mnemoverse.com` over HTTPS.

## Commands

| Command | What it does |
| ------- | ------------ |
| `Mnemoverse: Set API Key` | Enter or rotate your API key. Clears any existing one first. |
| `Mnemoverse: Clear API Key` | Remove the stored API key. Next server start re-prompts. |
| `Mnemoverse: Open Documentation` | Open the docs in your default browser. |

## Universal memory

The same API key works across every MCP-compatible AI tool you use:

- [Claude Code & Claude Desktop](https://mnemoverse.com/docs/api/claude) — `claude mcp add` one-liner
- [Cursor, VS Code, Windsurf](https://mnemoverse.com/docs/api/editors) — drop-in JSON snippets
- [ChatGPT Custom GPT](https://mnemoverse.com/docs/api/chatgpt) — via GPT Actions / OpenAPI
- [Python SDK](https://mnemoverse.com/docs/api/python-sdk) — `pip install mnemoverse`
- [REST API](https://mnemoverse.com/docs/api/reference) — raw HTTP

Write a memory in Cursor → Copilot Chat reads it. Learn something in VS Code Agent Mode → ChatGPT knows it.

## Privacy

- Your API key is stored in the OS keychain via `vscode.SecretStorage` — not on disk, not in git, not in settings.json.
- The extension itself contains no telemetry.
- Memory content is sent to `core.mnemoverse.com` (HTTPS) and stored per your Mnemoverse account. See [privacy policy](https://mnemoverse.com/legal/privacy-policy).

## Security disclosures

Found a vulnerability? Contact [security@mnemoverse.com](mailto:security@mnemoverse.com) or open a private advisory on the [mcp-memory-server repo](https://github.com/mnemoverse/mcp-memory-server/security/advisories/new). Coordinated disclosure policy: [mnemoverse.com/.well-known/security.txt](https://mnemoverse.com/.well-known/security.txt).

## Source

MIT licensed: [github.com/mnemoverse/mnemoverse-vscode](https://github.com/mnemoverse/mnemoverse-vscode). Contributions welcome.
