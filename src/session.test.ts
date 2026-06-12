import { describe, it, expect, beforeEach } from "vitest";
import { wasConnectPromptShown, claimConnectPrompt, resetConnectPrompt } from "./session";

// Module-level session state — reset before each test for isolation.
beforeEach(() => resetConnectPrompt());

describe("connect-prompt session guard", () => {
  it("starts unclaimed", () => {
    expect(wasConnectPromptShown()).toBe(false);
  });

  it("first claim wins and flips the flag; subsequent claims lose (idempotent)", () => {
    expect(claimConnectPrompt()).toBe(true); // welcome or agent-touch, whichever is first
    expect(wasConnectPromptShown()).toBe(true);
    expect(claimConnectPrompt()).toBe(false); // the other entry point — no second toast
    expect(claimConnectPrompt()).toBe(false);
  });

  it("models the welcome-vs-agent race: two near-simultaneous callers, only one shows", () => {
    // Both read the state, then both try to claim in the same tick.
    const before = wasConnectPromptShown();
    const a = claimConnectPrompt();
    const b = claimConnectPrompt();
    expect(before).toBe(false);
    expect([a, b]).toEqual([true, false]); // exactly one true
  });

  it("resetConnectPrompt re-arms for a deliberate sign-out then reconnect", () => {
    expect(claimConnectPrompt()).toBe(true);
    resetConnectPrompt();
    expect(wasConnectPromptShown()).toBe(false);
    expect(claimConnectPrompt()).toBe(true); // a fresh toast is allowed again
  });
});
