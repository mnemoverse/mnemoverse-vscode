# Add Mnemoverse to your editor's MCP config

Some editors (Kiro, Windsurf / Devin Desktop, Trae, Antigravity and others) read MCP servers only from their own config file. An extension can't add a server there for you yet.

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

The snippet contains no key. The hosted server signs you in through the browser when the editor first connects.

The setup guide for each editor: [mnemoverse.com/docs/api/editors](https://mnemoverse.com/docs/api/editors).
