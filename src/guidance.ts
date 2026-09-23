import * as vscode from "vscode";
import { EDITORS_GUIDE_URL, buildMcpConfigSnippet, mcpConfigTargetFor } from "./hosts";
import { appName, getHost, isRegistered } from "./state";
import { noteOnboardingToast } from "./session";
import { log } from "./log";

/**
 * The `guidance` adapter, for editors where an extension cannot add an MCP
 * server that the editor's agent will use: Kiro (the API exists but ignores
 * registrations), Windsurf/Devin Desktop, Trae, Antigravity (they read their own
 * config files), any host without `vscode.lm`, and — as a fallback — any host
 * whose adapter failed to start.
 *
 * It registers nothing and never claims a connection. It tells the user once,
 * plainly, and hands them a config snippet for the HOSTED OAuth server: the
 * snippet holds no key (the editor signs the user in itself), so it is safe to
 * paste anywhere. This version deliberately does not write any config file —
 * those files belong to the user and to the editor, and their locations are
 * still moving (Windsurf → Devin, Antigravity).
 */

const GUIDANCE_SHOWN_KEY = "mnemoverse.guidanceShown";

/**
 * One sentence, reused by the first-run toast and by Sign In on these hosts.
 * When guidance is only a fallback (the host's adapter failed), it says that
 * instead of blaming the editor.
 */
function guidanceText(): string {
  return getHost().fallbackFrom
    ? `Mnemoverse couldn't add its MCP server in ${appName()} (details in "Mnemoverse: Show Log"). Add it to the MCP config in one step instead.`
    : `${appName()} doesn't let extensions add MCP servers yet. Add Mnemoverse to its MCP config in one step.`;
}

/** The toast with its two buttons. Awaited by nobody on the activation path. */
async function showGuidanceToast(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(guidanceText(), "Copy config", "Open guide");
  if (choice === "Copy config") {
    await vscode.commands.executeCommand("mnemoverse.copyMcpConfig");
  } else if (choice === "Open guide") {
    await vscode.env.openExternal(vscode.Uri.parse(EDITORS_GUIDE_URL));
  }
}

/** First-run notice on a guidance host: once ever, persisted before showing. */
export async function showGuidanceIntro(context: vscode.ExtensionContext): Promise<void> {
  if (context.globalState.get<boolean>(GUIDANCE_SHOWN_KEY, false)) {
    return;
  }
  await context.globalState.update(GUIDANCE_SHOWN_KEY, true);
  noteOnboardingToast();
  await showGuidanceToast();
}

/**
 * What Sign In / Complete sign-in do on a guidance host: the keyless sign-in
 * mints a key for the local server, which these editors never start — so
 * point at the step that actually connects memory instead.
 */
export async function explainGuidance(): Promise<void> {
  await showGuidanceToast();
}

/**
 * `mnemoverse.copyMcpConfig`: put the hosted-server snippet for this editor on
 * the clipboard and say where it goes.
 *
 * Where the extension already registers Mnemoverse (VS Code-family hosts, or
 * Cursor after a successful registration), the snippet is still offered — it is
 * useful for other MCP clients — but the message warns against also adding it
 * to this editor, which would list every tool twice.
 */
export async function copyMcpConfig(): Promise<void> {
  const host = getHost();
  const snippet = buildMcpConfigSnippet(host.id);
  await vscode.env.clipboard.writeText(snippet);
  log.info(`Copied the MCP config snippet for host "${host.id}"`);

  const app = appName();
  if (isRegistered()) {
    await vscode.window.showInformationMessage(
      `Copied an MCP config for Mnemoverse's hosted server. This extension already adds Mnemoverse in ${app}, so don't also add the snippet to ${app}'s own config (every tool would appear twice); use it in other MCP clients.`,
    );
    return;
  }
  const target = mcpConfigTargetFor(host.id);
  const choice = await vscode.window.showInformationMessage(
    `Copied. Paste it into ${target.file}; if the file already lists servers, add the "mnemoverse" entry inside "${target.rootKey}". The hosted server signs you in through the browser the first time ${app} connects.`,
    "Open guide",
  );
  if (choice === "Open guide") {
    await vscode.env.openExternal(vscode.Uri.parse(EDITORS_GUIDE_URL));
  }
}
