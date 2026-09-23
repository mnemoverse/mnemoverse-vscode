import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { fakeNodeBin, flush, load, tempDir } from "./helpers";

const HOSTED = "https://mcp.mnemoverse.com/mcp";

let savedPath: string | undefined;
beforeEach(() => {
  savedPath = process.env.PATH;
  process.env.PATH = fakeNodeBin();
});
afterEach(() => {
  process.env.PATH = savedPath;
});

/** Activate in a VS Code-like host and return the registered provider. */
async function activateWithProvider(opts: { key?: string; appName?: string; uriScheme?: string } = {}) {
  const { vscode, ext } = await load();
  vscode.__setHost({ appName: opts.appName ?? "Visual Studio Code", uriScheme: opts.uriScheme ?? "vscode" });
  const ctx = vscode.__makeContext({ version: "0.3.0", globalState: { "mnemoverse.welcomeShown": true } });
  if (opts.key) ctx.__secrets.set("mnemoverse.apiKey", opts.key);
  await ext.activate(ctx as never);
  await flush();
  const provider = vscode.__state.lmProviders.get("mnemoverse.memory");
  expect(provider).toBeDefined();
  return { vscode, ext, ctx, provider };
}

describe("local connection (default)", () => {
  it("provides the npx stdio server with no secret in the unresolved definition", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    expect(def).toBeInstanceOf(vscode.McpStdioServerDefinition);
    expect(def.command).toBe("npx");
    expect(def.args).toEqual(["-y", "@mnemoverse/mcp-memory-server@latest"]);
    expect(def.version).toBe("0.3.0");
    expect(JSON.stringify(def)).not.toContain("mk_live");
  });

  it("injects the key and MNEMOVERSE_CLIENT into a real stdio definition", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    const resolved = await provider.resolveMcpServerDefinition(def, { isCancellationRequested: false });
    expect(resolved.env).toEqual({ MNEMOVERSE_API_KEY: "mk_live_abc", MNEMOVERSE_CLIENT: "vscode-extension" });
    expect(resolved).toBeInstanceOf(vscode.McpStdioServerDefinition);
  });

  it("Theia: a plain-object definition with no env and NO token still gets the key", async () => {
    const { provider } = await activateWithProvider({ key: "mk_live_theia", appName: "Theia", uriScheme: "theia" });
    const plain = { label: "Mnemoverse Memory", command: "npx", args: ["-y", "@mnemoverse/mcp-memory-server@latest"] };
    const resolved = await provider.resolveMcpServerDefinition(plain);
    expect(resolved.env.MNEMOVERSE_API_KEY).toBe("mk_live_theia");
    expect(resolved.env.MNEMOVERSE_CLIENT).toBe("vscode-extension");
  });

  it("a cancelled token aborts with CancellationError", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    await expect(provider.resolveMcpServerDefinition(def, { isCancellationRequested: true })).rejects.toBeInstanceOf(
      vscode.CancellationError,
    );
  });

  it("no key: refuses to start and shows one Sign In toast per session", async () => {
    const { vscode, provider } = await activateWithProvider();
    const { SIGN_IN_REQUIRED_MESSAGE } = await import("../src/signin-core");
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    await expect(provider.resolveMcpServerDefinition(def)).rejects.toThrow(SIGN_IN_REQUIRED_MESSAGE);
    await expect(provider.resolveMcpServerDefinition(def)).rejects.toThrow(SIGN_IN_REQUIRED_MESSAGE);
    await flush();
    const toasts = vscode.__state.messages.filter((m) => m.items.includes("Sign In"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toContain("Visual Studio Code");
  });

  it("npx missing: clear error, one toast with Use hosted connection / Install Node.js", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    process.env.PATH = tempDir("mnemoverse-empty-"); // no npx anywhere
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    await expect(provider.resolveMcpServerDefinition(def)).rejects.toThrow(
      "Mnemoverse's local server needs Node.js 18+ (npx was not found on PATH)",
    );
    await expect(provider.resolveMcpServerDefinition(def)).rejects.toThrow(/Node\.js 18\+/);
    await flush();
    const toasts = vscode.__state.messages.filter((m) => m.items.includes("Use hosted connection"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].items).toEqual(["Use hosted connection", "Install Node.js"]);
  });

  it("the Node toast's 'Use hosted connection' switches the setting globally and fires the change event", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    process.env.PATH = tempDir("mnemoverse-empty-");
    let changes = 0;
    provider.onDidChangeMcpServerDefinitions(() => changes++);
    vscode.__setResponder((m) => (m.items.includes("Use hosted connection") ? "Use hosted connection" : undefined));
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    await expect(provider.resolveMcpServerDefinition(def)).rejects.toThrow();
    await flush();
    expect(vscode.__state.config.get("mnemoverse.connection")).toBe("hosted");
    expect(changes).toBe(1);
    const [hosted] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    expect(hosted).toBeInstanceOf(vscode.McpHttpServerDefinition);
  });

  it("the Node toast's 'Install Node.js' opens nodejs.org", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    process.env.PATH = tempDir("mnemoverse-empty-");
    vscode.__setResponder((m) => (m.items.includes("Install Node.js") ? "Install Node.js" : undefined));
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    await expect(provider.resolveMcpServerDefinition(def)).rejects.toThrow();
    await flush();
    expect(vscode.__state.opened).toContain("https://nodejs.org/en/download");
  });
});

describe("hosted connection", () => {
  it("provides an HTTP definition for the hosted server, with no headers", async () => {
    const { vscode, provider } = await activateWithProvider();
    await vscode.workspace.getConfiguration("mnemoverse").update("connection", "hosted", vscode.ConfigurationTarget.Global);
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    expect(def).toBeInstanceOf(vscode.McpHttpServerDefinition);
    expect(def.uri.toString()).toBe(HOSTED);
    expect(def.headers).toEqual({});
    expect(def.label).toBe("Mnemoverse Memory");
    expect(def.version).toBe("0.3.0-hosted");
  });

  it("resolve passes the HTTP definition through untouched, even with no key and no Node", async () => {
    const { vscode, provider } = await activateWithProvider();
    process.env.PATH = tempDir("mnemoverse-empty-");
    await vscode.workspace.getConfiguration("mnemoverse").update("connection", "hosted");
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    const before = JSON.stringify(def);
    const resolved = await provider.resolveMcpServerDefinition(def);
    expect(resolved).toBe(def);
    expect(JSON.stringify(resolved)).toBe(before);
    expect(vscode.__state.messages).toHaveLength(0);
  });

  it("changing mnemoverse.connection fires onDidChangeMcpServerDefinitions", async () => {
    const { vscode, provider } = await activateWithProvider();
    let changes = 0;
    provider.onDidChangeMcpServerDefinitions(() => changes++);
    await vscode.workspace.getConfiguration("mnemoverse").update("connection", "hosted");
    await vscode.workspace.getConfiguration("mnemoverse").update("connection", "local");
    expect(changes).toBe(2);
  });

  it("counts as connected without a key (the editor's OAuth signs the user in)", async () => {
    const { vscode } = await activateWithProvider();
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(false);
    await vscode.workspace.getConfiguration("mnemoverse").update("connection", "hosted");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(true);
  });

  it("Sign In on the hosted connection explains the editor's sign-in instead of minting a key", async () => {
    const { vscode } = await activateWithProvider();
    await vscode.workspace.getConfiguration("mnemoverse").update("connection", "hosted");
    await vscode.commands.executeCommand("mnemoverse.signIn");
    expect(vscode.__state.opened).toEqual([]);
    expect(vscode.__state.messages.at(-1)?.message).toContain("signs you in itself");
  });

  it("an unexpected connection value reads as local", async () => {
    const { vscode, provider } = await activateWithProvider({ key: "mk_live_abc" });
    vscode.__state.config.set("mnemoverse.connection", "banana");
    const [def] = await provider.provideMcpServerDefinitions({ isCancellationRequested: false });
    expect(def).toBeInstanceOf(vscode.McpStdioServerDefinition);
  });
});
