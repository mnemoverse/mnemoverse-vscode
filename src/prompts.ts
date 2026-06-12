import * as vscode from "vscode";
import { claimConnectPrompt } from "./session";

/**
 * One-click "Connect" toast offering the keyless Sign In.
 *
 * Used in two places: the first-run welcome (extension.ts) and the agent-touch
 * path (provider.ts, when a memory tool is invoked without a stored key).
 *
 * Self-guarded and idempotent: `claimConnectPrompt()` (synchronous) makes this
 * a no-op if a connect toast already fired this session, so callers need not
 * coordinate — the welcome and an agent-touch resolve racing on first launch
 * still produce at most one toast.
 *
 * Clicking "Sign In" runs the SAME `mnemoverse.signIn` command the palette
 * exposes — the connect step stays fully human-driven (the user approves in the
 * browser). We only route the click into the existing flow; this helper
 * never mints, stores, or sees a key. The command handler in extension.ts is
 * already wrapped to surface its own errors, so a sign-in failure here is not
 * silent. Fire-and-forget by design: callers do not await the user's choice.
 */
export async function promptConnect(
  detail = "Connect Mnemoverse to use memory in Copilot Chat.",
): Promise<void> {
  if (!claimConnectPrompt()) {
    return;
  }
  const choice = await vscode.window.showInformationMessage(detail, "Sign In", "Later");
  if (choice === "Sign In") {
    await vscode.commands.executeCommand("mnemoverse.signIn");
  }
}
