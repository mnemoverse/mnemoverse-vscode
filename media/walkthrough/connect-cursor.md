# Sign in from Cursor's MCP settings

Cursor doesn't use VS Code's MCP API for extensions. It has its own, and the extension uses it to add Mnemoverse's hosted server (`https://mcp.mnemoverse.com/mcp`) to Cursor's MCP servers. It is listed as **extension-mnemoverse**.

To finish:

1. Open **Cursor Settings → Tools & MCPs**.
2. Click **Connect** (or **Login**) next to **extension-mnemoverse**.
3. Approve the connection in your browser.

Cursor keeps the sign-in; the extension doesn't use a key in Cursor. To sign out, click **Logout** next to the server in the same place.

If Mnemoverse was already in your `~/.cursor/mcp.json` or the project's `.cursor/mcp.json`, the extension doesn't add a second copy, so the tools don't appear twice.
