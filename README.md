# Mnemoverse for VS Code

> Persistent memory for AI coding assistants. One sign-in, every tool.

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue)](https://marketplace.visualstudio.com/items?itemName=mnemoverse.mnemoverse)
[![Docs](https://img.shields.io/badge/Docs-mnemoverse.com-cyan)](https://mnemoverse.com/docs/api/vscode)

Mnemoverse gives your AI coding assistant persistent memory across sessions. The same memory works across **Claude Code, ChatGPT, Cursor, and any AI tool** you connect — write once, recall anywhere.

## Status

🚧 Under construction — see [issues](https://github.com/mnemoverse/vscode-mnemoverse/issues) for sprint progress.

## Architecture

- OAuth 2.0 + PKCE authentication via `auth.mnemoverse.com`
- VS Code SecretStorage for token storage (encrypted, OS keychain)
- Auto-refresh on token expiry
- Writes `.vscode/mcp.json` for MCP-compatible AI tools
- Status bar indicator + commands

## Universal memory

This extension is **one of many ways** to access your Mnemoverse memory:

- [Claude Code & Desktop](https://mnemoverse.com/docs/api/claude)
- [Cursor & Windsurf](https://mnemoverse.com/docs/api/editors)
- [ChatGPT Custom GPT](https://mnemoverse.com/docs/api/chatgpt)
- [Python SDK](https://mnemoverse.com/docs/api/python-sdk)
- [REST API](https://mnemoverse.com/docs/api/reference)

Sign in once with your Mnemoverse account → memory follows you everywhere.

## License

MIT
