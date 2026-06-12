import * as vscode from "vscode";

/**
 * Session guard so the user sees at most ONE "Connect" toast per activation.
 * Both entry points — the first-run welcome (extension.ts) and the agent-touch
 * path (provider.ts, when a memory tool is invoked without a key) — funnel
 * through `promptConnect`, which sets this synchronously on entry. VS Code can
 * resolve the MCP server around the same time activation runs the welcome; the
 * guard makes whichever fires first the only toast, with no cross-module flag
 * plumbing. Resets naturally on the next extension-host session.
 */
let sessionPrompted = false;

/** Whether a connect toast has already been shown this session. */
export function wasConnectPromptShown(): boolean {
  return sessionPrompted;
}

/**
 * One-click "Connect" toast offering the keyless Sign In.
 *
 * Clicking "Sign In" runs the SAME `mnemoverse.signIn` command the palette
 * exposes — the connect step stays fully human-driven (browser + anti-phishing
 * confirm code). We only route the click into the existing flow; this helper
 * never mints, stores, or sees a key. The command handler in extension.ts is
 * already wrapped to surface its own errors, so failures here are not silent.
 *
 * Sets the session guard synchronously (before the first await) so two near-
 * simultaneous callers cannot both pass `wasConnectPromptShown()` and double-
 * toast. Fire-and-forget by design: callers do not await the user's choice — a
 * thrown "not signed in" error or activation must not block on a toast the user
 * may ignore.
 */
export async function promptConnect(
  detail = "Connect Mnemoverse to use memory in Copilot Chat.",
): Promise<void> {
  sessionPrompted = true;
  const choice = await vscode.window.showInformationMessage(detail, "Sign In", "Later");
  if (choice === "Sign In") {
    await vscode.commands.executeCommand("mnemoverse.signIn");
  }
}
