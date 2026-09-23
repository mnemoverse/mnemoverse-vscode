# Add Mnemoverse to your editor's MCP config

Some editors (Kiro, Windsurf / Devin Desktop, Trae, Antigravity and others) read MCP servers only from their own config file. An extension can't add a server there for you yet. The same config also works when the extension tried to add its server in your editor and couldn't (**Mnemoverse: Show Log** has the error).

**Copy config** puts a snippet for Mnemoverse's hosted server on your clipboard and tells you which file to paste it into. For example, for Kiro (`~/.kiro/settings/mcp.json`):

```json
{
  "mcpServers": {
    "mnemoverse": {
      "url": "https://mcp.mnemoverse.com/mcp"
    }
  }
}
```

The snippet contains no key. When the editor first connects, it should sign you in to the hosted server through the browser. That is checked for Kiro; for Windsurf / Devin Desktop and Trae, see the setup guide if no browser window opens. Antigravity is the exception for now: Mnemoverse doesn't accept Antigravity's sign-in yet, and the setup guide has the current status. Antigravity also needs a **Refresh** in its MCP server list (or a restart) after you save the file.

Once the entry is in the file, the extension notices it on the next start (for Kiro, Windsurf / Devin Desktop and Antigravity) and shows **In your MCP config** instead of **Set up needed**.

The setup guide for each editor: [mnemoverse.com/docs/api/editors](https://mnemoverse.com/docs/api/editors).
