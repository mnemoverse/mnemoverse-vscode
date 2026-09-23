import * as vscode from "vscode";
import { claimConnectPrompt } from "./session";
import { canBrowserSignIn } from "./hosts";
import { CONSOLE_BASE_URL } from "./signin-core";

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
 *
 * Editors whose URI scheme the console does not accept (Positron, Theia,
 * VSCodium Insiders, unknown forks — see hosts.ts BROWSER_SIGNIN_SCHEMES) are
 * offered the console and a pasted key instead: a browser Sign In there ends
 * on "not from a supported editor" after a long wait.
 */
export async function promptConnect(detail?: string): Promise<void> {
  if (!claimConnectPrompt()) {
    return;
  }
  // Host-aware default: the agent that uses these tools is the editor's own
  // chat, which is not always Copilot Chat (Positron, Theia AI, VSCodium with a
  // sideloaded agent), so the text names the editor instead.
  const app = vscode.env.appName || "your editor";
  const text = detail ?? `Connect Mnemoverse to use memory with the agent in ${app}.`;
  if (!canBrowserSignIn(vscode.env.uriScheme)) {
    const choice = await vscode.window.showInformationMessage(
      `${text} Browser sign-in isn't available in ${app} yet: create a key in the console, then paste it with "Set API Key".`,
      "Open console",
      "Set API Key",
      "Later",
    );
    if (choice === "Open console") {
      await vscode.env.openExternal(vscode.Uri.parse(CONSOLE_BASE_URL));
    } else if (choice === "Set API Key") {
      await vscode.commands.executeCommand("mnemoverse.setApiKey");
    }
    return;
  }
  const choice = await vscode.window.showInformationMessage(text, "Sign In", "Later");
  if (choice === "Sign In") {
    await vscode.commands.executeCommand("mnemoverse.signIn");
  }
}
