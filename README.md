# Mnemoverse Agent Memory

> Your coding agent remembers decisions, preferences and lessons across chats and projects, and learns which memories helped. Works in VS Code with GitHub Copilot agent mode and in Cursor.

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Aextension%2FMnemoverse.mnemoverse-vscode)
[![Add to Cursor](https://img.shields.io/badge/Cursor-Add_to_Cursor-000000?logo=cursor&logoColor=white)](https://cursor.com/install-mcp?name=mnemoverse&config=eyJ1cmwiOiJodHRwczovL21jcC5tbmVtb3ZlcnNlLmNvbS9tY3AifQ==)
[![VS Code Marketplace](https://vsmarketplacebadges.dev/version-short/Mnemoverse.mnemoverse-vscode.svg)](https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/mnemoverse/mnemoverse-vscode?label=Open%20VSX&color=c160ef)](https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## What you get

- **Memory that carries over.** The agent saves preferences, decisions and lessons with `memory_write` and finds them again with `memory_read` in any later chat: across sessions, branches and projects.
- **It learns from outcomes.** When the agent rates a recalled memory as helpful or harmful with `memory_feedback`, that rating changes how the memory ranks the next time.
- **Shared rooms (Beta).** Share a memory pool with other agents and people, and read what they wrote.
- **One memory across your tools.** The same Mnemoverse account works in Claude, ChatGPT and other MCP clients. Each tool connects in its own way (see [Other clients](#other-clients)).

No `.vscode/mcp.json` to edit and no JSON to commit: the extension registers the memory server with the editor itself.

## Get started

### VS Code (1.102 or newer, GitHub Copilot agent mode)

1. [Install the extension](https://vscode.dev/redirect?url=vscode%3Aextension%2FMnemoverse.mnemoverse-vscode), or search for **Mnemoverse** in the Extensions view.
2. Run **Mnemoverse: Sign In** from the Command Palette, or click **Sign In** on the welcome notice. Your browser opens `console.mnemoverse.com`; approve the connection. There is no key to copy: it is created for you and kept in the OS keychain.
3. Open chat, switch the mode picker to **Agent** (MCP tools run only there), and run **Mnemoverse: Try It in Chat**.

No Node.js on this machine? Run **Mnemoverse: Use Hosted Connection (no Node.js)**. VS Code then signs you in through the browser the first time the agent uses memory.

### Cursor

Cursor's **Agents Window** runs no extensions, so Mnemoverse has to be in your Cursor MCP settings to work there. Either way below ends with the same entry, `mnemoverse`, which every Cursor window can use:

- **[Add to Cursor](https://cursor.com/install-mcp?name=mnemoverse&config=eyJ1cmwiOiJodHRwczovL21jcC5tbmVtb3ZlcnNlLmNvbS9tY3AifQ==)**: Cursor opens its MCP settings and asks you to confirm. No extension needed.
- **Or install this extension** (Extensions view, search for **Mnemoverse**; Cursor installs from [Open VSX](https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode)). It adds Mnemoverse to the current editor window right away and offers **Add to Cursor (all windows)** for the rest.

Then click **Connect** next to `mnemoverse` in **Cursor Settings → Tools & MCPs**, approve in the browser, and ask the agent to remember something.

### Kiro, Windsurf / Devin Desktop, Trae

These editors don't let extensions add MCP servers yet. Run **Mnemoverse: Copy MCP Config**: it copies a config entry for the hosted server in the editor's format and names the file to paste it into. The entry contains no key.

## Try it

In agent chat, tell the agent something true with today's date (**Mnemoverse: Try It in Chat** fills it in):

> Remember that I set up Mnemoverse memory in VS Code on 2026-09-23.

Open a **new chat** and ask:

> When and where did I set up Mnemoverse memory?

If the agent answers with that date and editor, memory is connected. The memory stays across sessions, across machines on the same account, and in every other Mnemoverse-connected tool.

## Where it works

What the extension can do depends on the editor it is installed in:

| Editor | What the extension does |
| ------ | ----------------------- |
| **VS Code 1.102+**, Insiders | Registers Mnemoverse as an MCP server through VS Code's MCP API. The agent in chat (Agent mode) gets the memory tools. |
| **VSCodium, Positron, Eclipse Theia** | The same, through the same API. The tools appear only where the editor's agent uses MCP servers from extensions (for example VSCodium with a separately installed agent, or Positron with Copilot tools). Browser Sign In is not yet accepted from Positron, Theia, VSCodium Insiders or other forks the console doesn't know; there the extension offers **Set API Key** with a key from the [console](https://console.mnemoverse.com) instead. |
| **Cursor** | In editor windows, adds Mnemoverse's hosted server as `extension-mnemoverse`. Cursor's Agents Window runs no extensions, so the extension offers **Add to Cursor (all windows)**: Cursor's own install puts `mnemoverse` in your Cursor MCP settings, and the extension then removes its in-window copy so tools aren't listed twice. You sign in from **Cursor Settings → Tools & MCPs** (click Connect); Cursor runs the sign-in and holds it. If your `~/.cursor/mcp.json` or the project's `.cursor/mcp.json` already has Mnemoverse, the extension adds nothing. |
| **Kiro, Windsurf / Devin Desktop, Trae, Antigravity** | These editors don't let extensions add MCP servers yet. The extension says so and offers **Copy MCP config**: a snippet for the hosted server, with the name of the config file to paste it into. It doesn't write any config file. It reads the file (Kiro, Windsurf / Devin Desktop, Antigravity) to notice when Mnemoverse is already there. **Antigravity:** Mnemoverse doesn't accept Antigravity's sign-in yet, so memory can't be connected there for now; the [setup guide](https://mnemoverse.com/docs/api/editors) has the current status. |

The status bar item (**Mnemoverse**) shows what happened in your editor: **Connected** (local server, signed in), **Sign in**, **Node.js needed**, **Added to _editor_** (hosted connection: the editor runs its own sign-in), **Added to this window** (a Cursor editor window; run **Add to Cursor** for the Agents Window), **In your MCP config** (you added Mnemoverse to the editor's config yourself), or **Set up needed**. **Mnemoverse: Show Log** has the details.

## Requirements

- **VS Code 1.102** or newer, for the MCP server API this extension uses. Other editors: see [Where it works](#where-it-works).
- **GitHub Copilot** in VS Code, with chat in **Agent** mode. Copilot Free works; on Copilot Business or Enterprise an admin must allow MCP servers. Other editors use their own agent.
- A free **Mnemoverse account**: sign up at [console.mnemoverse.com](https://console.mnemoverse.com), no credit card.
- **Node.js 18+** on your PATH, only for the default **local** connection, where the extension runs the memory server with `npx`. The **hosted** connection (setting `mnemoverse.connection: hosted`) and Cursor need no Node.js. If `npx` is missing, the extension says so before Sign In opens the browser, and offers to switch to the hosted connection.

## Tools the agent gets

The local connection runs [`@mnemoverse/mcp-memory-server`](https://github.com/mnemoverse/mcp-memory-server) with `npx`; the hosted connection and Cursor use `https://mcp.mnemoverse.com/mcp`. Both give the agent these tools:

| Tool | What it does |
| ---- | ------------ |
| `memory_write` | Store a preference, decision or lesson |
| `memory_read` | Search memories with a natural-language query |
| `memory_list_recent` | List the newest memories first, no search query needed |
| `memory_feedback` | Rate a memory as helpful or harmful; the rating changes how it ranks later |
| `memory_stats` | Show how many memories are stored, which domains exist, and average valence and importance |
| `memory_create_room`, `memory_invite_to_room`, `memory_join_room`, `memory_list_rooms` | Share a memory pool with other agents and people through rooms (Beta) |
| `vault_list` | List your Vault secrets by alias and purpose; the value is never returned |

The [server README](https://github.com/mnemoverse/mcp-memory-server#tools) has the full reference. Deleting memories is an administrative REST operation, not a tool; see the [privacy and deletion policy](https://github.com/mnemoverse/mcp-memory-server#privacy-policy).

## Other clients

The extension connects the editor you install it in. Other tools connect to the same account in their own way:

| Client | How to connect Mnemoverse |
| ------ | ------------------------- |
| **VS Code without this extension** | [Remote server URL with OAuth](https://mnemoverse.com/docs/api/vs-code) |
| **Cursor** | This extension, the [Cursor plugin, remote URL or `.cursor/mcp.json`](https://mnemoverse.com/docs/api/cursor): pick one, not several |
| **Windsurf** | [Windsurf guide](https://mnemoverse.com/docs/api/windsurf) |
| **Claude Code** | [`claude mcp add` one-liner](https://mnemoverse.com/docs/api/claude) |
| **Claude Desktop / claude.ai** | [Remote connector or config file](https://mnemoverse.com/docs/api/claude-apps) |
| **ChatGPT** | [OAuth connector (developer mode), or a Custom GPT with GPT Actions and an API key](https://mnemoverse.com/docs/api/chatgpt) |
| **Any HTTP client** | [REST API](https://mnemoverse.com/docs/api/reference) |

## Commands

| Command | What it does |
| ------- | ------------ |
| `Mnemoverse: Sign In` | Connect your memory via the browser, with no key to paste. The default for the local connection. Without Node.js it says so first and offers the hosted connection. Where the console doesn't accept the editor (Positron, Theia, VSCodium Insiders) it offers **Set API Key** instead. In Cursor it explains Cursor's own sign-in; in editors that need a config entry it offers **Copy config**. |
| `Mnemoverse: Complete sign-in` | Finish a Sign In when the browser couldn't return automatically: paste the code from the page. |
| `Mnemoverse: Sign Out` | Local connection: forget the stored key on this device. The key stays valid until you revoke it in the [console](https://console.mnemoverse.com). Hosted connection, Cursor and config-file editors: the editor holds the sign-in, so the command removes any key the extension stored and tells you where the editor's own sign-out is (VS Code: **MCP: List Servers** → Mnemoverse Memory → Sign Out; Cursor: **Cursor Settings → Tools & MCPs** → Logout). |
| `Mnemoverse: Set API Key (paste manually)` | Fallback: paste a key directly (VS Code-family editors; Cursor and config-file editors don't use a key, and the command says so). It replaces the stored key only when you enter a valid one; cancelling keeps the current key. |
| `Mnemoverse: Clear API Key` | Remove the stored key. The local server won't start until you reconnect. |
| `Mnemoverse: Copy MCP Config` | Copy a config snippet for the hosted server (`https://mcp.mnemoverse.com/mcp`) in your editor's format, and show which file it goes in. The snippet contains no key. |
| `Mnemoverse: Add to Cursor (all windows)` | Cursor only: open Cursor's install for `mnemoverse` in your Cursor MCP settings (the server address only, no key), so the Agents Window can use memory too. |
| `Mnemoverse: Open MCP Settings` | Open the place where your editor manages MCP servers (Cursor Settings → Tools & MCPs, or VS Code's **MCP: List Servers**). |
| `Mnemoverse: Use Hosted Connection (no Node.js)` / `Use Local Connection (npx)` | Switch the `mnemoverse.connection` setting. |
| `Mnemoverse: Get Started` | Open the walkthrough: connect, try it, share a room. |
| `Mnemoverse: Try It in Chat` | Open agent chat with a first memory prompt filled in (VS Code), or show the steps. |
| `Mnemoverse: Show Menu` | The status bar menu: the actions that apply to your editor. |
| `Mnemoverse: Show Log` | Open the **Mnemoverse** output channel (host detection, what was registered, errors). |
| `Mnemoverse: Open Documentation` | Open the [VS Code guide](https://mnemoverse.com/docs/api/vs-code) in your browser. |
| `Mnemoverse: Rate Mnemoverse` / `Star on GitHub` | Open the review page of the store your editor uses, or the GitHub repository. |

If your browser can't return you to the editor after Sign In (some remote/SSH setups, or a browser that blocks custom URL schemes), copy the code the page shows and run **Mnemoverse: Complete sign-in** to paste it.

## Settings

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `mnemoverse.connection` | `local` | `local`: run the server on this machine with `npx` (Node.js 18+) and the key from **Sign In**, kept in the OS keychain. `hosted`: use `https://mcp.mnemoverse.com/mcp`; the editor signs you in through the browser the first time the agent uses memory, and the extension doesn't need or send a key. Applies in editors that use VS Code's MCP API; Cursor and the config-file editors always use the hosted server. |
| `mnemoverse.showStatusBar` | `true` | Show the **Mnemoverse** item in the status bar. |

## How it works

In VS Code the extension uses `vscode.lm.registerMcpServerDefinitionProvider`: it tells the editor how to start the Mnemoverse server at runtime instead of writing a `.vscode/mcp.json` file into your workspace. No config files are created.

On the local connection, when the agent first reaches for memory, VS Code calls the extension's `resolveMcpServerDefinition`. The extension reads your key from `vscode.SecretStorage` (the OS keychain) and starts `npx -y @mnemoverse/mcp-memory-server@latest` with the key in the child process environment. `@latest` means you get new releases of the open-source [mcp-memory-server](https://github.com/mnemoverse/mcp-memory-server) automatically. The server is a thin stdio wrapper that forwards tool calls to `core.mnemoverse.com/api/v1` over HTTPS; the key is used only to authenticate those calls.

With `mnemoverse.connection` set to `hosted`, the provider returns an HTTP server definition for `https://mcp.mnemoverse.com/mcp` instead. Nothing is spawned; VS Code runs the MCP OAuth sign-in itself. In Cursor, which doesn't implement VS Code's provider API, the extension registers the same URL through Cursor's own `vscode.cursor.mcp.registerServer`, and Cursor runs the sign-in.

## Privacy and security

- Your API key is stored only in `vscode.SecretStorage` (OS keychain: macOS Keychain, Windows Credential Vault, Linux libsecret). Never on disk, never in settings.json, never in git.
- With the hosted connection, and in Cursor, the extension doesn't need or send a key: the editor holds the OAuth sign-in. A key stored earlier (for the local connection, or by version 0.2 in Cursor) stays in the keychain until you run **Sign Out** or **Clear API Key**; on the hosted connection the status bar menu offers **Remove stored key**.
- The extension only reads MCP config files: Cursor's `mcp.json` files (to avoid adding Mnemoverse twice) and the Kiro, Windsurf and Antigravity config (to see whether you already added it). It counts only an entry for `https://mcp.mnemoverse.com` or the `@mnemoverse/mcp-memory-server` package run through npx (or pnpm, yarn, bun), and it skips files that are large, not regular files, or, inside a workspace, symlinks. It never writes any MCP config file itself: **Add to Cursor** hands the entry to Cursor's own install, which you confirm in Cursor, and the connection commands change only the `mnemoverse.connection` setting.
- The extension contains zero telemetry of its own.
- Memory content is sent to `core.mnemoverse.com` over HTTPS. The [Mnemoverse privacy policy](https://mnemoverse.com/privacy) says what is stored and for how long.
- Capabilities declared in `package.json`: `untrustedWorkspaces: false` (the local connection spawns `npx`, which runs third-party code), `virtualWorkspaces: false` (the extension needs a local extension host).

### Security disclosures

Found a vulnerability? Contact [security@mnemoverse.com](mailto:security@mnemoverse.com) or file a private advisory at [github.com/mnemoverse/mnemoverse-vscode/security/advisories/new](https://github.com/mnemoverse/mnemoverse-vscode/security/advisories/new). Coordinated disclosure policy: [mnemoverse.com/.well-known/security.txt](https://mnemoverse.com/.well-known/security.txt).

## From the author

I'm Eduard Izgorodin, and I build Mnemoverse. I made this extension because my agents kept starting from zero: every new chat in Copilot, Claude or Cursor asked again what the previous one had already learned. I use Mnemoverse memory every day across those tools, and our team runs its shared rooms on it.

If it helps you, a rating on the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode&ssr=false#review-details) or [Open VSX](https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode/reviews) helps other developers find it, and a [star on GitHub](https://github.com/mnemoverse/mnemoverse-vscode) helps too. If something breaks or feels wrong, [open an issue](https://github.com/mnemoverse/mnemoverse-vscode/issues). I read every one.

— Eduard

## Source

MIT licensed: [github.com/mnemoverse/mnemoverse-vscode](https://github.com/mnemoverse/mnemoverse-vscode). Contributions welcome.
