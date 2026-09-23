# Connect your memory

**Sign In** opens `console.mnemoverse.com` in your browser. Approve the connection there and the editor picks it up: the key is minted for you and kept in the OS keychain. You never copy or paste it.

After that, the agent in this editor can store and recall memories. MCP tools run in the chat's **Agent** mode.

The console's browser sign-in doesn't accept Positron, Theia or VSCodium Insiders yet. In those editors, create a key at [console.mnemoverse.com](https://console.mnemoverse.com) and paste it with **Mnemoverse: Set API Key**; the extension offers this when you click **Sign In**.

## Two ways to connect

| Connection | What runs | Sign-in |
| --- | --- | --- |
| **Local** (default) | `npx @mnemoverse/mcp-memory-server` on this machine. Needs Node.js 18+. | **Mnemoverse: Sign In** |
| **Hosted** | Nothing local. The editor talks to `https://mcp.mnemoverse.com/mcp`. | The editor asks you to sign in through the browser the first time the agent uses memory. |

Switch with **Mnemoverse: Use Hosted Connection** or the `mnemoverse.connection` setting. Both connections reach the same memory.
