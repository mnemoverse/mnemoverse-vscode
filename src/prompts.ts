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
export async function promptConnect(detail?: string): Promise<void> {
  if (!claimConnectPrompt()) {
    return;
  }
  // Host-aware default: the agent that uses these tools is the editor's own
  // chat, which is not always Copilot Chat (Positron, Theia AI, VSCodium with a
  // sideloaded agent), so the text names the editor instead.
  const text =
    detail ?? `Connect Mnemoverse to use memory with the agent in ${vscode.env.appName || "your editor"}.`;
  const choice = await vscode.window.showInformationMessage(text, "Sign In", "Later");
  if (choice === "Sign In") {
    await vscode.commands.executeCommand("mnemoverse.signIn");
  }
}
