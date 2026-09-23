import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fakeNodeBin, flush, load, tempDir } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

let savedPath: string | undefined;
let savedHome: string | undefined;
let home: string;
beforeEach(() => {
  savedPath = process.env.PATH;
  savedHome = process.env.HOME;
  process.env.PATH = fakeNodeBin();
  // The Cursor and config-file adapters read MCP configs under HOME: never the developer's own.
  home = tempDir("mnemoverse-home-");
  process.env.HOME = home;
});
afterEach(() => {
  process.env.PATH = savedPath;
  process.env.HOME = savedHome;
  vi.useRealTimers();
});

const VETERAN_RATING = { firstSeen: Date.now() - 10 * DAY, activeDays: 5, lastActiveDay: "2000-01-01", askCount: 0, neverAsk: false };

/** A connected long-time user: installed 10 days ago, 5 active days, welcome already seen. */
async function veteran(appName = "Visual Studio Code", uriScheme = "vscode", extra: Record<string, unknown> = {}) {
  const { vscode, ext } = await load();
  vscode.__setHost({ appName, uriScheme });
  const ctx = vscode.__makeContext({
    globalState: {
      "mnemoverse.welcomeShown": true,
      "mnemoverse.rating": VETERAN_RATING,
      ...extra,
    },
  });
  ctx.__secrets.set("mnemoverse.apiKey", "mk_live_abc");
  await ext.activate(ctx as never);
  await flush();
  const rating = await import("../src/rating");
  return { vscode, ctx, rating };
}

describe("rating prompt (glue)", () => {
  it("asks a connected veteran once, naming the Marketplace in VS Code", async () => {
    const { vscode, ctx, rating } = await veteran();
    expect(await rating.maybeAskForRating(ctx as never)).toBe(true);
    const m = vscode.__state.messages.at(-1)!;
    expect(m.message).toBe("Is Mnemoverse Memory useful? A rating on the VS Code Marketplace helps other developers find it.");
    expect(m.items).toEqual(["Rate", "Later", "Don't ask again"]);
    // Once per session.
    expect(await rating.maybeAskForRating(ctx as never)).toBe(false);
    expect((ctx.__global.get("mnemoverse.rating") as { askCount: number }).askCount).toBe(1);
  });

  it("names Open VSX in a fork and opens its review page on Rate, then never asks again", async () => {
    const { vscode, ctx, rating } = await veteran("VSCodium", "vscodium");
    vscode.__setResponder((m) => (m.items.includes("Rate") ? "Rate" : undefined));
    expect(await rating.maybeAskForRating(ctx as never)).toBe(true);
    expect(vscode.__state.messages.at(-1)!.message).toContain("A rating on Open VSX");
    expect(vscode.__state.opened).toContain("https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode/reviews");
    expect((ctx.__global.get("mnemoverse.rating") as { neverAsk: boolean }).neverAsk).toBe(true);
  });

  it("stays quiet in a session that already showed an onboarding toast", async () => {
    const { vscode, ctx, rating } = await veteran();
    const session = await import("../src/session");
    session.noteOnboardingToast();
    expect(await rating.maybeAskForRating(ctx as never)).toBe(false);
    expect(vscode.__state.messages).toHaveLength(0);
  });

  it("never asks a user who is not connected", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({ appName: "Kiro", uriScheme: "kiro" });
    const ctx = vscode.__makeContext({
      globalState: {
        "mnemoverse.guidanceShown": true,
        "mnemoverse.rating": { firstSeen: Date.now() - 60 * DAY, activeDays: 40, askCount: 0, neverAsk: false },
      },
    });
    await ext.activate(ctx as never);
    const rating = await import("../src/rating");
    expect(await rating.maybeAskForRating(ctx as never)).toBe(false);
  });

  it("Cursor: never asks when the extension only added its server (Cursor's sign-in is invisible to us)", async () => {
    const { vscode, ext } = await load();
    vscode.__setHost({
      appName: "Cursor",
      uriScheme: "cursor",
      lm: "stub",
      cursor: { mcp: { registerServer: vi.fn(), unregisterServer: vi.fn() } },
    });
    const ctx = vscode.__makeContext({
      globalState: { "mnemoverse.cursorIntroShown": true, "mnemoverse.rating": VETERAN_RATING },
    });
    await ext.activate(ctx as never);
    await flush();
    const rating = await import("../src/rating");
    expect(vscode.__state.context.get("mnemoverse.connected")).toBe(true); // offered to the agent...
    expect(await rating.maybeAskForRating(ctx as never)).toBe(false); // ...but not known to work
  });

  it("Cursor: asks when the user's own ~/.cursor/mcp.json has Mnemoverse", async () => {
    fs.mkdirSync(path.join(home, ".cursor"));
    fs.writeFileSync(
      path.join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { mnemoverse: { command: "npx", args: ["-y", "@mnemoverse/mcp-memory-server@latest"], env: {} } } }),
    );
    const { vscode, ext } = await load();
    vscode.__setHost({
      appName: "Cursor",
      uriScheme: "cursor",
      lm: "stub",
      cursor: { mcp: { registerServer: vi.fn(), unregisterServer: vi.fn() } },
    });
    const ctx = vscode.__makeContext({ globalState: { "mnemoverse.rating": VETERAN_RATING } });
    await ext.activate(ctx as never);
    await flush();
    const rating = await import("../src/rating");
    expect(await rating.maybeAskForRating(ctx as never)).toBe(true);
    expect(vscode.__state.messages.at(-1)!.message).toContain("A rating on Open VSX");
  });

  it("fires from the ~3-minute timer after activation, and the timer dies with the extension", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { vscode, ctx, rating } = await veteran();
    expect(rating.RATING_DELAY_MS).toBe(3 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(rating.RATING_DELAY_MS + 10);
    await flush();
    expect(vscode.__state.messages.some((m) => m.message.startsWith("Is Mnemoverse Memory useful?"))).toBe(true);

    // A second activation disposed before the delay never asks.
    const second = await veteran();
    for (const d of second.ctx.subscriptions) d.dispose();
    await vi.advanceTimersByTimeAsync(rating.RATING_DELAY_MS + 10);
    await flush();
    expect(second.vscode.__state.messages).toHaveLength(0);
    void ctx;
  });

  it("counts one active day per calendar day on activation", async () => {
    const { ctx } = await veteran();
    const s = ctx.__global.get("mnemoverse.rating") as { activeDays: number };
    expect(s.activeDays).toBe(6); // 5 + today
  });

  it("the Rate command opens the store page for this editor", async () => {
    const { vscode } = await veteran("Cursor", "cursor");
    await vscode.commands.executeCommand("mnemoverse.rate");
    expect(vscode.__state.opened).toContain("https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode/reviews");
    await vscode.commands.executeCommand("mnemoverse.starOnGitHub");
    expect(vscode.__state.opened).toContain("https://github.com/mnemoverse/mnemoverse-vscode");
  });
});
