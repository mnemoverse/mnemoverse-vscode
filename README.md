# Mnemoverse Memory for VS Code

> Persistent memory for GitHub Copilot Chat Agent Mode that learns from outcomes, with shared rooms — one memory across every AI tool you connect.

[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/Mnemoverse.mnemoverse-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/mnemoverse/mnemoverse-vscode?label=Open%20VSX&color=c160ef)](https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode)
[![npm](https://img.shields.io/npm/v/@mnemoverse/mcp-memory-server.svg?color=cb3837&label=mcp%20server)](https://www.npmjs.com/package/@mnemoverse/mcp-memory-server)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-0ea5e9)](https://registry.modelcontextprotocol.io/v0.1/servers?search=mnemoverse)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## What this extension does

**Adds Mnemoverse Memory as an MCP server inside GitHub Copilot Chat's Agent Mode**, with no `.vscode/mcp.json` file to edit and no JSON config to commit. Once installed and connected, your Copilot agent gains tools for long-term memory: it can store facts, preferences, and decisions during one chat and recall them from any future chat — across sessions, branches, and projects.

### Scope (honest)

What the extension can do depends on the editor it is installed in:

| Editor | What the extension does |
| ------ | ----------------------- |
| **VS Code 1.102+**, Insiders | Registers Mnemoverse as an MCP server through VS Code's MCP API. The agent in chat (Agent mode) gets the memory tools. |
| **VSCodium, Positron, Eclipse Theia** | The same, through the same API. The tools appear only where the editor's agent uses MCP servers from extensions (for example VSCodium with a separately installed agent, or Positron with Copilot tools). Browser Sign In is not yet accepted from Positron and Theia; paste a key with **Set API Key** instead. |
| **Cursor** | Adds Mnemoverse's hosted server to Cursor's MCP servers, listed as `extension-mnemoverse`. You sign in from **Cursor Settings → Tools & MCPs** (click Connect next to it); Cursor runs the sign-in and holds it. If your `~/.cursor/mcp.json` or the project's `.cursor/mcp.json` already has Mnemoverse, the extension doesn't add a second copy. |
| **Kiro, Windsurf / Devin Desktop, Trae, Antigravity** | These editors don't let extensions add MCP servers yet. The extension says so and offers **Copy MCP config**: a snippet for the hosted server, with the name of the config file to paste it into. It doesn't write any config file. |

The status bar item (**Mnemoverse**) shows what happened in your editor: Connected, Sign in, Added to Cursor, or Set up needed. **Mnemoverse: Show Log** has the details.

If you use a different client, install Mnemoverse there directly — the memory is the same account, the setup is different:

| Client | Mode | How to install Mnemoverse |
| ------ | ---- | ------------------------- |
| **VS Code + Copilot Chat** | Agent Mode | **This extension** (1-click from Marketplace) |
| **VS Code + Copilot Chat** | Ask / Edit Mode | Not supported — MCP servers only run in Agent Mode |
| **Cursor** | built-in chat | **This extension** (from Open VSX), or the [`.cursor/mcp.json` snippet](https://mnemoverse.com/docs/api/editors) — not both |
| **Windsurf / Devin Desktop, Kiro, Trae, Antigravity** | built-in chat | **Mnemoverse: Copy MCP Config** in this extension, or the [setup guide](https://mnemoverse.com/docs/api/editors) |
| **Claude Code** | CLI | [`claude mcp add` one-liner](https://mnemoverse.com/docs/api/claude) |
| **Claude Desktop** | app | [`claude_desktop_config.json` snippet](https://mnemoverse.com/docs/api/claude) |
| **ChatGPT** | Custom GPT | [GPT Actions + OAuth](https://mnemoverse.com/docs/api/chatgpt) |
| **Any HTTP client** | — | [REST API](https://mnemoverse.com/docs/api/reference) |

Write a memory in any of the tools above → read it from any other. **Same Mnemoverse account, same memory layer, different integration plumbing per client.**

## Requirements

- **VS Code 1.102** or newer — required for the `registerMcpServerDefinitionProvider` API this extension uses (other editors: see [Scope](#scope-honest))
- **GitHub Copilot Chat** extension installed and signed in
- A free **Mnemoverse account** — sign up at [console.mnemoverse.com](https://console.mnemoverse.com), no credit card (you connect from VS Code in one click — no key to copy or paste)
- **Node.js 18+** on your PATH — only for the default **local** connection, where the extension runs the memory server with `npx`. The **hosted** connection (setting `mnemoverse.connection: hosted`) and Cursor need no Node.js. If `npx` is missing, the extension says so and offers to switch to the hosted connection.

## Install

1. Search for **"Mnemoverse Memory"** in the VS Code Marketplace and click **Install**.
2. Run **`Mnemoverse: Sign In`** from the Command Palette (or click **Sign In** on the welcome notification). Your browser opens `console.mnemoverse.com`; approve the connection and you're connected. No API key to copy or paste: the key is minted for you and stored in the OS keychain, never on disk.
3. Open Copilot Chat (`Cmd/Ctrl+Shift+I`), switch the mode picker to **Agent** (MCP servers only show there), and ask the agent to remember something.

If your browser can't return you to VS Code automatically (some remote/SSH setups, or a browser that blocks custom URL schemes), copy the code the page shows and run **`Mnemoverse: Complete sign-in`** to paste it. Or skip the browser entirely and paste a key by hand with **`Mnemoverse: Set API Key (paste manually)`** — keyless Sign In is just the default.

## Try it

In a Copilot Chat Agent Mode session:

> Remember that I prefer Railway for deployments.

Open a **new chat** and ask:

> Where should I deploy this?

If Copilot recalls Railway, everything is wired up. The memory persists across sessions, machines with the same account, and every other Mnemoverse-connected tool.

## Tools exposed to the agent

The extension launches `@mnemoverse/mcp-memory-server@latest` via `npx`. Common tools include:

| Tool | What it does |
| ---- | ------------ |
| `memory_write` | Store a preference, decision, or lesson |
| `memory_read` | Search memories by natural-language query |
| `memory_feedback` | Rate a memory as helpful or harmful (affects future retrieval) |
| `memory_stats` | Show total memories, domains, and average importance |
| `memory_list_recent` | List the newest memories first, no search query needed |
| `memory_create_room`, `memory_invite_to_room`, `memory_join_room`, `memory_list_rooms` | Share a memory pool with other agents and people through rooms |

For the complete current tool list, see the [server README](https://github.com/mnemoverse/mcp-memory-server#tools). Memory deletion is an administrative REST operation, not exposed by this MCP server; see the [privacy and deletion policy](https://github.com/mnemoverse/mcp-memory-server#privacy-policy).

## Commands

| Command | What it does |
| ------- | ------------ |
| `Mnemoverse: Sign In` | Connect your memory via the browser — no key to paste. The default for the local connection. In Cursor it explains Cursor's own sign-in; in editors that need a config entry it offers **Copy config**. |
| `Mnemoverse: Complete sign-in` | Finish a Sign In when the browser couldn't return automatically — paste the code from the page. |
| `Mnemoverse: Sign Out` | Forget the stored key on this device. The key stays valid until you revoke it in the [console](https://console.mnemoverse.com). |
| `Mnemoverse: Set API Key (paste manually)` | Fallback: paste a key directly. It replaces the stored key only when you enter a valid one; cancelling keeps the current key. |
| `Mnemoverse: Clear API Key` | Remove the stored key. The local server won't start until you reconnect. |
| `Mnemoverse: Copy MCP Config` | Copy a config snippet for the hosted server (`https://mcp.mnemoverse.com/mcp`) in your editor's format, and show which file it goes in. The snippet contains no key. |
| `Mnemoverse: Open MCP Settings` | Open the place where your editor manages MCP servers (Cursor Settings → Tools & MCPs, or VS Code's **MCP: List Servers**). |
| `Mnemoverse: Use Hosted Connection (no Node.js)` / `Use Local Connection (npx)` | Switch the `mnemoverse.connection` setting. |
| `Mnemoverse: Get Started` | Open the walkthrough: connect, try it, share a room. |
| `Mnemoverse: Try It in Chat` | Open agent chat with a first memory prompt filled in (VS Code), or show the steps. |
| `Mnemoverse: Show Menu` | The status bar menu: the actions that apply to your editor. |
| `Mnemoverse: Show Log` | Open the **Mnemoverse** output channel (host detection, what was registered, errors). |
| `Mnemoverse: Open Documentation` | Open the docs in your default browser. |
| `Mnemoverse: Rate Mnemoverse` / `Star on GitHub` | Open the review page of the store your editor uses, or the GitHub repository. |

## Settings

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `mnemoverse.connection` | `local` | `local`: run the server on this machine with `npx` (Node.js 18+) and the key from **Sign In**, kept in the OS keychain. `hosted`: use `https://mcp.mnemoverse.com/mcp`; the editor signs you in through the browser the first time the agent uses memory, and the extension stores no key. Applies in editors that use VS Code's MCP API; Cursor and the config-file editors always use the hosted server. |
| `mnemoverse.showStatusBar` | `true` | Show the **Mnemoverse** item in the status bar. |

## How it works (internals)

This extension uses `vscode.lm.registerMcpServerDefinitionProvider` — the canonical 2026 path for third-party MCP server integration in VS Code. It contributes an entry to VS Code's Language Model namespace rather than writing a `.vscode/mcp.json` file in your workspace. No config files are created.

When Copilot Chat Agent Mode calls into our provider's `resolveMcpServerDefinition`, we pull your API key from `vscode.SecretStorage` (OS keychain) and spawn `npx -y @mnemoverse/mcp-memory-server@latest` with the key in the child process environment. The `@latest` tag ensures you automatically get new releases of the underlying [mcp-memory-server](https://github.com/mnemoverse/mcp-memory-server) npm package — same binary our docs point Claude Desktop and Cursor users at, same open-source implementation.

The server itself is a thin stdio wrapper that forwards tool calls to `core.mnemoverse.com/api/v1` over HTTPS. The API key never leaves your machine for any purpose except authenticating API calls to Mnemoverse.

With `mnemoverse.connection` set to `hosted`, the provider returns an HTTP server definition for `https://mcp.mnemoverse.com/mcp` instead. Nothing is spawned; VS Code runs the MCP OAuth sign-in itself. In Cursor, which doesn't implement VS Code's provider API, the extension registers the same URL through Cursor's own `vscode.cursor.mcp.registerServer`, and Cursor runs the sign-in.

## Privacy and security

- Your API key is stored only in `vscode.SecretStorage` (OS keychain — macOS Keychain, Windows Credential Vault, Linux libsecret). Never on disk, never in settings.json, never in git.
- With the hosted connection, and in Cursor, the extension stores no key at all: the editor holds the OAuth sign-in.
- The extension only reads Cursor's `mcp.json` files (to avoid adding Mnemoverse twice); it never writes any editor config file.
- The extension contains zero telemetry of its own.
- Memory content is sent to `core.mnemoverse.com` over HTTPS. See the [Mnemoverse privacy policy](https://mnemoverse.com/legal/privacy-policy) for what is stored and for how long.
- Capabilities declared in `package.json`: `untrustedWorkspaces: false` (we spawn `npx`, which runs arbitrary third-party code), `virtualWorkspaces: false` (we need a local Node.js runtime).

### Security disclosures

Found a vulnerability? Contact [security@mnemoverse.com](mailto:security@mnemoverse.com) or file a private advisory at [github.com/mnemoverse/mnemoverse-vscode/security/advisories/new](https://github.com/mnemoverse/mnemoverse-vscode/security/advisories/new). Coordinated disclosure policy: [mnemoverse.com/.well-known/security.txt](https://mnemoverse.com/.well-known/security.txt).

## Source

MIT licensed: [github.com/mnemoverse/mnemoverse-vscode](https://github.com/mnemoverse/mnemoverse-vscode). Contributions welcome.
