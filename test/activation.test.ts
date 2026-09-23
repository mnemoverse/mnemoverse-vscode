import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fakeNodeBin, flush, load, manifest, manifestCommands, tempDir } from "./helpers";

const HOSTED = "https://mcp.mnemoverse.com/mcp";

let savedHome: string | undefined;
let savedPath: string | undefined;
let home: string;

beforeEach(() => {
  savedHome = process.env.HOME;
  savedPath = process.env.PATH;
  // An empty home: no ~/.cursor/mcp.json unless a test writes one.
  home = tempDir("mnemoverse-home-");
  process.env.HOME = home;
  process.env.PATH = fakeNodeBin();
});

afterEach(() => {
  process.env.HOME = savedHome;
  process.env.PATH = savedPath;
  vi.restoreAllMocks();
});

function cursorApi(register = vi.fn(), unregister = vi.fn()) {
  return { mcp: { registerServer: register, unregisterServer: unregister } };
}

describe("activation fault isolation", () => {
  it("with vscode.lm undefined, still registers every command and the URI handler", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Some Fork", uriScheme: "somefork", lm: "absent" });
    const ctx = vscode.__makeContext();
    await ext.activate(ctx as never);
    await flush();

    expect([...vscode.__state.commands.keys()].sort()).toEqual(manifestCommands().sort());
    expect(vscode.__state.uriHandlers).toHaveLength(1);
    expect(vscode.__state.context.get("mnemoverse.host")).toBe("guidance");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(false);
    // Honest first-run guidance instead of a false "connected".
    const intro = vscode.__state.messages.find((m) => m.message.includes("doesn't let extensions add MCP servers yet"));
    expect(intro?.message).toContain("Some Fork");
    expect(intro?.items).toEqual(["Copy config", "Open guide"]);
    expect(vscode.__state.messages.some((m) => /connected/i.test(m.message))).toBe(false);
  });

  it("when provider registration throws, falls back to guidance and keeps the commands", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    vscode.lm.registerMcpServerDefinitionProvider = () => {
      throw new Error("duplicate provider id");
    };
    const ctx = vscode.__makeContext();
    await expect(ext.activate(ctx as never)).resolves.toBeUndefined();
    await flush();

    expect([...vscode.__state.commands.keys()].sort()).toEqual(manifestCommands().sort());
    expect(vscode.__state.context.get("mnemoverse.host")).toBe("guidance");
    expect(vscode.__state.logLines.some((l) => l.includes("duplicate provider id"))).toBe(true);
  });

  it("every command in package.json is registered, and nothing undeclared is", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    await ext.activate(vscode.__makeContext() as never);
    expect([...vscode.__state.commands.keys()].sort()).toEqual(manifestCommands().sort());
  });

  it("logs host detection to the output channel", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "VSCodium", uriScheme: "vscodium" });
    await ext.activate(vscode.__makeContext() as never);
    expect(vscode.__state.logLines.some((l) => l.includes('"VSCodium"') && l.includes('adapter "lm"'))).toBe(true);
  });
});

describe("lm hosts (VS Code family)", () => {
  it("registers the provider under the manifest id and sets context keys", async () => {
    const { vscode, ext } = await load();
    const { PROVIDER_ID } = await import("../src/provider");
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    await ext.activate(vscode.__makeContext() as never);
    await flush();

    expect(manifest().contributes.mcpServerDefinitionProviders[0].id).toBe(PROVIDER_ID);
    expect(vscode.__state.lmProviders.has(PROVIDER_ID)).toBe(true);
    expect(vscode.__state.context.get("mnemoverse.host")).toBe("lm");
    // Registered, but no key yet: not connected, and the welcome names the editor.
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(false);
    const welcome = vscode.__state.messages.find((m) => m.message.startsWith("Welcome to Mnemoverse"));
    expect(welcome?.message).toContain("Visual Studio Code");
    expect(welcome?.message).not.toContain("Copilot Chat");
  });

  it("is connected once a key is stored", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    const ctx = vscode.__makeContext();
    ctx.__secrets.set("mnemoverse.apiKey", "mk_live_abc");
    await ext.activate(ctx as never);
    await flush();
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(true);
  });

  it("Kiro exposes the provider but is never trusted with it", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Kiro", uriScheme: "kiro" });
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    expect(vscode.__state.lmProviders.size).toBe(0);
    expect(vscode.__state.context.get("mnemoverse.host")).toBe("guidance");
  });
});

describe("Cursor adapter", () => {
  it("registers the hosted URL with Cursor, with no headers, and never relies on the lm stub", async () => {
    const { vscode, ext } = await load();
    const register = vi.fn();
    const unregister = vi.fn();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi(register, unregister) });
    const ctx = vscode.__makeContext();
    await ext.activate(ctx as never);
    await flush();

    expect(register).toHaveBeenCalledTimes(1);
    const arg = register.mock.calls[0][0];
    expect(arg).toEqual({ name: "mnemoverse", server: { url: HOSTED } });
    expect(Object.keys(arg.server)).toEqual(["url"]); // no headers: Cursor drops them
    expect(vscode.__state.context.get("mnemoverse.host")).toBe("cursor");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(true);

    const intro = vscode.__state.messages.find((m) => m.message.includes("added to Cursor's MCP servers"));
    expect(intro?.message).toContain("Tools & MCPs");
    expect(intro?.items).toEqual(["Open MCP settings"]);

    // Disposal must not unregister: in Cursor that also clears the OAuth sign-in.
    for (const d of ctx.subscriptions) d.dispose();
    expect(unregister).not.toHaveBeenCalled();
  });

  it("skips registration when ~/.cursor/mcp.json already has Mnemoverse (JSONC)", async () => {
    fs.mkdirSync(path.join(home, ".cursor"));
    fs.writeFileSync(
      path.join(home, ".cursor", "mcp.json"),
      `{
        // added from the docs
        "mcpServers": { "mnemoverse": { "url": "https://mcp.mnemoverse.com/mcp" }, },
      }`,
    );
    const { vscode, ext } = await load();
    const register = vi.fn();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi(register) });
    await ext.activate(vscode.__makeContext() as never);
    await flush();

    expect(register).not.toHaveBeenCalled();
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(true);
    expect(vscode.__state.logLines.some((l) => l.includes("already configured"))).toBe(true);
    expect(vscode.__state.messages.some((m) => m.message.includes("added to Cursor's MCP servers"))).toBe(false);
  });

  it("skips registration when a workspace .cursor/mcp.json runs the npm package", async () => {
    const ws = tempDir("mnemoverse-ws-");
    fs.mkdirSync(path.join(ws, ".cursor"));
    fs.writeFileSync(
      path.join(ws, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { mem: { command: "npx", args: ["-y", "@mnemoverse/mcp-memory-server"], env: {} } } }),
    );
    const { vscode, ext } = await load();
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(ws), name: "ws", index: 0 }];
    const register = vi.fn();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi(register) });
    await ext.activate(vscode.__makeContext() as never);
    expect(register).not.toHaveBeenCalled();
  });

  it("registers anyway when ~/.cursor/mcp.json is invalid", async () => {
    fs.mkdirSync(path.join(home, ".cursor"));
    fs.writeFileSync(path.join(home, ".cursor", "mcp.json"), "{ this is not json");
    const { vscode, ext } = await load();
    const register = vi.fn();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi(register) });
    await ext.activate(vscode.__makeContext() as never);
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("falls back to guidance if Cursor rejects the registration", async () => {
    const { vscode, ext } = await load();
    const register = vi.fn(() => Promise.reject(new Error("Invalid MCP server config")));
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi(register) });
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    expect(vscode.__state.context.get("mnemoverse.host")).toBe("guidance");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(false);
    expect([...vscode.__state.commands.keys()].sort()).toEqual(manifestCommands().sort());
  });

  it("Sign In explains Cursor's own sign-in instead of minting a key", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi() });
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    vscode.__state.messages.length = 0;
    await vscode.commands.executeCommand("mnemoverse.signIn");

    expect(vscode.__state.opened).toEqual([]); // no browser sign-in to the console
    expect(vscode.__state.messages[0].message).toContain("signs in through Cursor itself");
    expect(vscode.__state.messages[0].items).toEqual(["Open MCP settings"]);
  });

  it("Open MCP settings uses the first Cursor settings command that exists", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi() });
    const generic = vi.fn();
    vscode.__state.externalCommands.set("aiSettings.action.open", generic);
    await ext.activate(vscode.__makeContext() as never);
    await vscode.commands.executeCommand("mnemoverse.openMcpSettings");
    expect(generic).toHaveBeenCalledWith("mcp");
  });

  it("Open MCP settings falls back to written steps when no settings command exists", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi() });
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    vscode.__state.messages.length = 0;
    await vscode.commands.executeCommand("mnemoverse.openMcpSettings");
    expect(vscode.__state.messages[0].message).toContain("Cursor Settings → Tools & MCPs");
  });

  it("Set API Key explains that Cursor doesn't use the key, and stores nothing unless asked", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi() });
    const ctx = vscode.__makeContext();
    await ext.activate(ctx as never);
    await flush();
    vscode.__state.inputBox = () => "mk_live_new";
    vscode.__setResponder(() => undefined); // dismiss the explanation
    await vscode.commands.executeCommand("mnemoverse.setApiKey");
    expect(ctx.__secrets.has("mnemoverse.apiKey")).toBe(false);

    vscode.__setResponder((m) => (m.items.includes("Set key anyway") ? "Set key anyway" : undefined));
    await vscode.commands.executeCommand("mnemoverse.setApiKey");
    expect(ctx.__secrets.get("mnemoverse.apiKey")).toBe("mk_live_new");
  });
});

describe("guidance hosts: Copy MCP config", () => {
  it("Kiro: copies a url snippet and names ~/.kiro/settings/mcp.json", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Kiro", uriScheme: "kiro" });
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    vscode.__state.messages.length = 0;
    await vscode.commands.executeCommand("mnemoverse.copyMcpConfig");
    expect(JSON.parse(vscode.__state.clipboard)).toEqual({ mcpServers: { mnemoverse: { url: HOSTED } } });
    expect(vscode.__state.messages[0].message).toContain("~/.kiro/settings/mcp.json");
  });

  it("Windsurf: copies a serverUrl snippet", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Windsurf", uriScheme: "windsurf" });
    await ext.activate(vscode.__makeContext() as never);
    await vscode.commands.executeCommand("mnemoverse.copyMcpConfig");
    expect(JSON.parse(vscode.__state.clipboard)).toEqual({ mcpServers: { mnemoverse: { serverUrl: HOSTED } } });
  });

  it("the first-run toast's Copy config button copies the snippet", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Antigravity", uriScheme: "antigravity" });
    vscode.__setResponder((m) => (m.items.includes("Copy config") ? "Copy config" : undefined));
    await ext.activate(vscode.__makeContext() as never);
    await flush(10);
    expect(JSON.parse(vscode.__state.clipboard)).toEqual({ mcpServers: { mnemoverse: { serverUrl: HOSTED } } });
  });

  it("the first-run toast shows once ever", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Trae", uriScheme: "trae" });
    await ext.activate(vscode.__makeContext({ globalState: { "mnemoverse.guidanceShown": true } }) as never);
    await flush();
    expect(vscode.__state.messages).toHaveLength(0);
  });

  it("Sign In on a guidance host points at the config step, not the browser", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Kiro", uriScheme: "kiro" });
    await ext.activate(vscode.__makeContext({ globalState: { "mnemoverse.guidanceShown": true } }) as never);
    await vscode.commands.executeCommand("mnemoverse.signIn");
    expect(vscode.__state.opened).toEqual([]);
    expect(vscode.__state.messages[0].message).toContain("Kiro doesn't let extensions add MCP servers yet");
  });

  it("in VS Code, copying warns that the extension already adds the server", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    vscode.__state.messages.length = 0;
    await vscode.commands.executeCommand("mnemoverse.copyMcpConfig");
    expect(JSON.parse(vscode.__state.clipboard)).toEqual({ servers: { mnemoverse: { type: "http", url: HOSTED } } });
    expect(vscode.__state.messages[0].message).toContain("appear twice");
  });
});

describe("status bar", () => {
  it("shows '$(database) Mnemoverse', opens the menu, and describes the state", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    await ext.activate(vscode.__makeContext() as never);
    const item = vscode.__state.statusItems[0];
    expect(item.text).toBe("$(database) Mnemoverse");
    expect(item.command).toBe("mnemoverse.showMenu");
    expect(item.alignment).toBe(vscode.StatusBarAlignment.Right);
    expect(item.visible).toBe(true);
    expect(String(item.tooltip)).toContain("Sign in");
  });

  it("says 'Added to Cursor' in Cursor and 'Set up needed' on guidance hosts", async () => {
    let { vscode, ext } = await load();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi() });
    await ext.activate(vscode.__makeContext() as never);
    expect(String(vscode.__state.statusItems[0].tooltip)).toContain("Added to Cursor");

    ({ vscode, ext } = await load());
    vscode.__setHost({ appName: "Kiro", uriScheme: "kiro" });
    await ext.activate(vscode.__makeContext() as never);
    expect(String(vscode.__state.statusItems[0].tooltip)).toContain("Set up needed");
  });

  it("hides when mnemoverse.showStatusBar is false, and reappears when it is turned back on", async () => {
    const { vscode, ext } = await load();
    vscode.__state.config.set("mnemoverse.showStatusBar", false);
    await ext.activate(vscode.__makeContext() as never);
    const item = vscode.__state.statusItems[0];
    expect(item.visible).toBe(false);
    await vscode.workspace.getConfiguration("mnemoverse").update("showStatusBar", true);
    expect(item.visible).toBe(true);
  });

  it("the menu offers host-relevant actions", async () => {
    let { vscode, ext } = await load();
    vscode.__setHost({ appName: "Kiro", uriScheme: "kiro" });
    await ext.activate(vscode.__makeContext() as never);
    let labels: string[] = [];
    vscode.__state.quickPick = (items) => {
      labels = items.map((i: { label: string }) => i.label);
      return undefined;
    };
    await vscode.commands.executeCommand("mnemoverse.showMenu");
    expect(labels.some((l) => l.includes("Copy MCP config"))).toBe(true);
    expect(labels.some((l) => l.includes("Sign In"))).toBe(false);
    expect(labels.some((l) => l.includes("Rate Mnemoverse"))).toBe(true);
    expect(labels.some((l) => l.includes("Star on GitHub"))).toBe(true);

    ({ vscode, ext } = await load());
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    await ext.activate(vscode.__makeContext() as never);
    vscode.__state.quickPick = (items) => {
      labels = items.map((i: { label: string }) => i.label);
      return items.find((i: { label: string }) => i.label.includes("Use hosted connection"));
    };
    await vscode.commands.executeCommand("mnemoverse.showMenu");
    expect(labels.some((l) => l.includes("Sign In"))).toBe(true);
    expect(vscode.__state.config.get("mnemoverse.connection")).toBe("hosted");
  });
});

describe("walkthrough and try-it", () => {
  it("Get Started opens the walkthrough by its full id", async () => {
    const { vscode, ext } = await load();
    const open = vi.fn();
    vscode.__state.externalCommands.set("workbench.action.openWalkthrough", open);
    await ext.activate(vscode.__makeContext() as never);
    await vscode.commands.executeCommand("mnemoverse.getStarted");
    expect(open).toHaveBeenCalledWith("Mnemoverse.mnemoverse-vscode#mnemoverse.getStarted", false);
    const wt = manifest().contributes.walkthroughs[0];
    expect(`Mnemoverse.mnemoverse-vscode#${wt.id}`).toBe("Mnemoverse.mnemoverse-vscode#mnemoverse.getStarted");
  });

  it("Try it opens agent chat with the prompt prefilled on lm hosts", async () => {
    const { vscode, ext } = await load();
    const chat = vi.fn();
    vscode.__state.externalCommands.set("workbench.action.chat.open", chat);
    await ext.activate(vscode.__makeContext() as never);
    await vscode.commands.executeCommand("mnemoverse.tryIt");
    expect(chat).toHaveBeenCalledWith({
      query: "Remember that I prefer Railway for deployments.",
      isPartialQuery: true,
      mode: "agent",
    });
  });

  it("Try it shows written steps (with Copy prompt) where chat can't be opened", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Cursor", uriScheme: "cursor", lm: "stub", cursor: cursorApi() });
    vscode.__setResponder((m) => (m.items.includes("Copy prompt") ? "Copy prompt" : undefined));
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    await vscode.commands.executeCommand("mnemoverse.tryIt");
    expect(vscode.__state.clipboard).toBe("Remember that I prefer Railway for deployments.");
  });
});

describe("adapter failure fallback copy", () => {
  it("says registration failed (not that the editor lacks the API) when an lm host's provider throws", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Visual Studio Code", uriScheme: "vscode" });
    vscode.lm.registerMcpServerDefinitionProvider = () => {
      throw new Error("boom");
    };
    await ext.activate(vscode.__makeContext() as never);
    await flush();
    const toast = vscode.__state.messages.find((m) => m.items.includes("Copy config"));
    expect(toast?.message).toContain("couldn't add its MCP server in Visual Studio Code");
    expect(toast?.message).not.toContain("doesn't let extensions");
    expect(String(vscode.__state.statusItems[0].tooltip)).toContain("could not add its server");
  });
});

describe("hosts with a thinner window API", () => {
  it("still registers every command when output channels and status bar items throw", async () => {
    const { vscode, ext } = await load();
    vscode.window.createOutputChannel = () => {
      throw new Error("no output channels here");
    };
    vscode.window.createStatusBarItem = () => {
      throw new Error("no status bar here");
    };
    await expect(ext.activate(vscode.__makeContext() as never)).resolves.toBeUndefined();
    expect([...vscode.__state.commands.keys()].sort()).toEqual(manifestCommands().sort());
    expect(vscode.__state.lmProviders.size).toBe(1);
  });

  it("falls back to a plain output channel when `{ log: true }` is unsupported", async () => {
    const { vscode, ext } = await load();
    const lines: string[] = [];
    vscode.window.createOutputChannel = ((_name: string, opts?: unknown) => {
      if (opts) throw new Error("unsupported options");
      return { appendLine: (l: string) => lines.push(l), show: () => undefined, dispose: () => undefined };
    }) as never;
    await ext.activate(vscode.__makeContext() as never);
    expect(lines.some((l) => l.includes("[info]") && l.includes("adapter"))).toBe(true);
  });
});
