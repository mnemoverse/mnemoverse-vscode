# Add Mnemoverse to Cursor and sign in

Cursor has two kinds of windows. Editor windows run extensions, so this extension adds Mnemoverse's hosted server (`https://mcp.mnemoverse.com/mcp`) there as **extension-mnemoverse**. Cursor's **Agents Window** runs no extensions, so it can't see that copy.

To use memory in every window:

1. Click **Add to Cursor (all windows)**. Cursor opens its MCP settings and asks you to confirm adding **mnemoverse** to your Cursor MCP settings (`~/.cursor/mcp.json`). The entry is the server address only: no key.
2. Click **Connect** (or **Login**) next to **mnemoverse** in **Cursor Settings → Tools & MCPs**.
3. Approve the connection in your browser.

Once the entry is in your settings, the extension removes its own in-window copy, so the tools aren't listed twice. Cursor keeps the sign-in; to sign out, click **Logout** next to the server in the same place.

If Mnemoverse was already in your `~/.cursor/mcp.json` or the project's `.cursor/mcp.json`, the extension adds nothing.
