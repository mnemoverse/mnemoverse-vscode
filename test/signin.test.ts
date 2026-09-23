import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fakeNodeBin, flush, load, tempDir, waitFor } from "./helpers";

let savedPath: string | undefined;
beforeEach(() => {
  savedPath = process.env.PATH;
  process.env.PATH = fakeNodeBin();
});
afterEach(() => {
  process.env.PATH = savedPath;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const CALLBACK = "vscode://mnemoverse.mnemoverse-vscode/auth-callback";
const STATE_43 = "A".repeat(43);

async function activate(opts: { key?: string; appName?: string; uriScheme?: string } = {}) {
  const { vscode, ext } = await load();
  vscode.__setHost({ appName: opts.appName ?? "Visual Studio Code", uriScheme: opts.uriScheme ?? "vscode" });
  const ctx = vscode.__makeContext({ globalState: { "mnemoverse.welcomeShown": true } });
  if (opts.key) ctx.__secrets.set("mnemoverse.apiKey", opts.key);
  await ext.activate(ctx as never);
  await flush();
  vscode.__state.messages.length = 0;
  const provider = vscode.__state.lmProviders.get("mnemoverse.memory");
  let changes = 0;
  provider?.onDidChangeMcpServerDefinitions(() => changes++);
  return { vscode, ctx, changes: () => changes };
}

describe("Set API Key (RE-08)", () => {
  it("cancelling the prompt keeps the existing key and changes nothing", async () => {
    const { vscode, ctx, changes } = await activate({ key: "mk_live_old" });
    vscode.__state.inputBox = () => undefined; // Escape
    await vscode.commands.executeCommand("mnemoverse.setApiKey");
    expect(ctx.__secrets.get("mnemoverse.apiKey")).toBe("mk_live_old");
    expect(changes()).toBe(0);
    expect(vscode.__state.messages).toHaveLength(0);
  });

  it("a valid entry overwrites the key and restarts the server", async () => {
    const { vscode, ctx, changes } = await activate({ key: "mk_live_old" });
    vscode.__state.inputBox = () => "  mk_live_new  ";
    await vscode.commands.executeCommand("mnemoverse.setApiKey");
    expect(ctx.__secrets.get("mnemoverse.apiKey")).toBe("mk_live_new");
    expect(changes()).toBe(1);
    expect(vscode.__state.messages[0].message).toBe("Mnemoverse API key saved.");
  });

  it("prompts before touching storage (the prompt sees the old key still stored)", async () => {
    const { vscode, ctx } = await activate({ key: "mk_live_old" });
    let storedDuringPrompt: string | undefined;
    vscode.__state.inputBox = () => {
      storedDuringPrompt = ctx.__secrets.get("mnemoverse.apiKey");
      return undefined;
    };
    await vscode.commands.executeCommand("mnemoverse.setApiKey");
    expect(storedDuringPrompt).toBe("mk_live_old");
  });
});

describe("late and unsolicited callbacks (RE-07)", () => {
  it("a well-formed callback with no sign-in in progress says the request expired, with Sign In", async () => {
    const { vscode } = await activate();
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?code=abc123&state=${STATE_43}`));
    await flush();
    expect(vscode.__state.messages).toHaveLength(1);
    expect(vscode.__state.messages[0].message).toBe("This sign-in finished after the request expired — run Sign In again.");
    expect(vscode.__state.messages[0].items).toEqual(["Sign In"]);
  });

  it("junk callbacks stay silent", async () => {
    const { vscode } = await activate();
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?code=abc&state=short`));
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?error=access_denied&state=${STATE_43}`));
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}`));
    await flush();
    expect(vscode.__state.messages).toHaveLength(0);
  });

  it("repeated late callbacks don't stack notices while one is open", async () => {
    const { vscode } = await activate();
    let release!: () => void;
    vscode.__setResponder(() => new Promise((r) => (release = () => r(undefined))));
    const uri = vscode.Uri.parse(`${CALLBACK}?code=abc123&state=${STATE_43}`);
    void vscode.__state.uriHandlers[0].handleUri(uri);
    void vscode.__state.uriHandlers[0].handleUri(uri);
    await flush();
    expect(vscode.__state.messages).toHaveLength(1);
    release();
  });

  it("the timeout is 30 minutes and offers Try again / Paste key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { vscode } = await activate();
    const signin = await import("../src/signin");
    expect(signin.TIMEOUT_MS).toBe(30 * 60 * 1000);
    const run = vscode.commands.executeCommand("mnemoverse.signIn");
    await waitFor(() => vscode.__state.opened.length > 0); // the attempt (and its timer) is armed
    await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
    expect(vscode.__state.messages).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(60 * 1000 + 10);
    await run;
    await flush();
    const warn = vscode.__state.messages.find((m) => m.level === "warning");
    expect(warn?.items).toEqual(["Try again", "Paste key"]);
  });
});

describe("full keyless sign-in", () => {
  function stubExchange(apiKey = "mk_live_minted") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ api_key: apiKey, email: "dev@example.com", key_prefix: "mk_live_mi", organization_id: "o", tier: "free", contract_version: 1 }),
      })),
    );
  }

  it("names the key after the editor and reports 'connected' only where the provider is registered", async () => {
    stubExchange();
    const { vscode, ctx, changes } = await activate({ appName: "VSCodium", uriScheme: "vscodium" });
    const run = vscode.commands.executeCommand("mnemoverse.signIn");
    await waitFor(() => vscode.__state.opened.length > 0);
    const connectUrl = new URL(vscode.__state.opened[0]);
    expect(connectUrl.searchParams.get("name")).toMatch(/^VSCodium — /);
    expect(connectUrl.searchParams.get("redirect_uri")).toBe("vscodium://mnemoverse.mnemoverse-vscode/auth-callback");
    const state = connectUrl.searchParams.get("state")!;
    await vscode.__state.uriHandlers[0].handleUri(
      vscode.Uri.parse(`vscodium://mnemoverse.mnemoverse-vscode/auth-callback?code=one-time&state=${state}`),
    );
    await run;
    await flush();

    expect(ctx.__secrets.get("mnemoverse.apiKey")).toBe("mk_live_minted");
    expect(changes()).toBe(1);
    expect(vscode.__state.messages.at(-1)?.message).toBe("Signed in to Mnemoverse as dev@example.com — memory connected in VSCodium.");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(true);

    // The browser delivering the same callback twice must not follow success with "expired".
    await vscode.__state.uriHandlers[0].handleUri(
      vscode.Uri.parse(`vscodium://mnemoverse.mnemoverse-vscode/auth-callback?code=one-time&state=${state}`),
    );
    await flush();
    expect(vscode.__state.messages.some((m) => m.message.includes("expired"))).toBe(false);
  });

  it("without npx, Sign In says so BEFORE the browser opens, and offers the hosted connection", async () => {
    const { vscode } = await activate();
    process.env.PATH = tempDir("mnemoverse-empty-");
    vscode.__setResponder(() => undefined); // dismiss
    await vscode.commands.executeCommand("mnemoverse.signIn");
    expect(vscode.__state.opened).toEqual([]); // no key minted for a server that can't start
    const notice = vscode.__state.messages[0];
    expect(notice.level).toBe("warning");
    expect(notice.message).toContain("npx was not found on PATH");
    expect(notice.items).toEqual(["Use hosted connection", "Install Node.js", "Sign in anyway"]);

    vscode.__setResponder((m) => (m.items.includes("Use hosted connection") ? "Use hosted connection" : undefined));
    await vscode.commands.executeCommand("mnemoverse.signIn");
    expect(vscode.__state.opened).toEqual([]);
    expect(vscode.__state.config.get("mnemoverse.connection")).toBe("hosted");
  });

  it("without npx, 'Sign in anyway' signs in but never reports or shows 'connected'", async () => {
    stubExchange();
    const { vscode } = await activate();
    process.env.PATH = tempDir("mnemoverse-empty-");
    vscode.__setResponder((m) => (m.items.includes("Sign in anyway") ? "Sign in anyway" : undefined));
    const run = vscode.commands.executeCommand("mnemoverse.signIn");
    await waitFor(() => vscode.__state.opened.length > 0);
    const state = new URL(vscode.__state.opened[0]).searchParams.get("state")!;
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?code=c&state=${state}`));
    await run;
    await flush();
    const texts = vscode.__state.messages.map((m) => m.message);
    expect(texts).toContain("Signed in to Mnemoverse as dev@example.com.");
    expect(texts.some((t) => t.includes("connected"))).toBe(false);
    expect(vscode.__state.messages.some((m) => m.items.includes("Use hosted connection"))).toBe(true);
    // The shared state agrees with the toast: not connected, and the tooltip says why.
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(false);
    const tooltip = String(vscode.__state.statusItems[0].tooltip);
    expect(tooltip).toContain("Node.js needed");
    expect(tooltip).not.toContain("Connected");
  });

  it("a superseded attempt's late approval stays silent once the newer attempt signed in", async () => {
    stubExchange();
    const { vscode, ctx } = await activate();
    const runA = vscode.commands.executeCommand("mnemoverse.signIn");
    await waitFor(() => vscode.__state.opened.length === 1);
    const stateA = new URL(vscode.__state.opened[0]).searchParams.get("state")!;
    const runB = vscode.commands.executeCommand("mnemoverse.signIn"); // supersedes A
    await waitFor(() => vscode.__state.opened.length === 2);
    const stateB = new URL(vscode.__state.opened[1]).searchParams.get("state")!;
    await runA;
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?code=b&state=${stateB}`));
    await runB;
    await flush();
    expect(ctx.__secrets.get("mnemoverse.apiKey")).toBe("mk_live_minted");

    vscode.__state.messages.length = 0;
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?code=a&state=${stateA}`));
    await flush();
    expect(vscode.__state.messages).toHaveLength(0); // no "run Sign In again": they are signed in
  });

  it("a timed-out attempt's late approval gets the notice, unless a later attempt signed in", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    stubExchange();
    const { vscode } = await activate();
    const runA = vscode.commands.executeCommand("mnemoverse.signIn");
    await waitFor(() => vscode.__state.opened.length === 1);
    const stateA = new URL(vscode.__state.opened[0]).searchParams.get("state")!;
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 10);
    await runA;
    await flush();

    vscode.__state.messages.length = 0;
    const lateA = vscode.Uri.parse(`${CALLBACK}?code=a&state=${stateA}`);
    await vscode.__state.uriHandlers[0].handleUri(lateA);
    await flush();
    expect(vscode.__state.messages.map((m) => m.message)).toEqual([
      "This sign-in finished after the request expired — run Sign In again.",
    ]);

    // Sign in successfully with a new attempt; A's approval arriving again is now moot.
    const runB = vscode.commands.executeCommand("mnemoverse.signIn");
    await waitFor(() => vscode.__state.opened.length === 2);
    const stateB = new URL(vscode.__state.opened[1]).searchParams.get("state")!;
    await vscode.__state.uriHandlers[0].handleUri(vscode.Uri.parse(`${CALLBACK}?code=b&state=${stateB}`));
    await runB;
    await flush();
    vscode.__state.messages.length = 0;
    await vscode.__state.uriHandlers[0].handleUri(lateA);
    await flush();
    expect(vscode.__state.messages).toHaveLength(0);
  });
});

describe("Sign Out (RE-14)", () => {
  it("says the key stays valid until revoked and links the console", async () => {
    const { vscode, ctx } = await activate({ key: "mk_live_abc" });
    vscode.__setResponder((m) => (m.items.includes("Open console") ? "Open console" : undefined));
    await vscode.commands.executeCommand("mnemoverse.signOut");
    expect(ctx.__secrets.has("mnemoverse.apiKey")).toBe(false);
    expect(vscode.__state.messages[0].message).toContain("stays valid until you revoke it in the console");
    expect(vscode.__state.opened).toContain("https://console.mnemoverse.com");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(false);
  });
});
