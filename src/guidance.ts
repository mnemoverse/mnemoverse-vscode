import * as vscode from "vscode";
import { EDITORS_GUIDE_URL, buildMcpConfigSnippet, mcpConfigTargetFor, type HostId, type McpConfigTarget } from "./hosts";
import { CONSOLE_BASE_URL } from "./signin-core";
import { appName, describeConfiguredEntry, getConfiguredEntry, getHost, isRegistered } from "./state";
import { findMnemoverseEntry, homeConfigFiles, type FoundEntry } from "./config-files";
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
 *
 * It does READ the editor's config file where the location is documented
 * (hosts.ts `homePaths`), once at activation, so a user who already pasted the
 * snippet sees "In your MCP config" instead of "Set up needed" on every launch.
 *
 * Every sign-in sentence follows the host's `signIn` status in hosts.ts: the
 * extension promises a browser sign-in only where auth.mnemoverse.com is known
 * to accept the editor's redirect, hedges where that is unverified, and says
 * plainly where it is refused today (Antigravity).
 */

const GUIDANCE_SHOWN_KEY = "mnemoverse.guidanceShown";

function target(): McpConfigTarget {
  return mcpConfigTargetFor(getHost().id);
}

/**
 * Look for an existing Mnemoverse entry in this host's documented config file(s).
 * Read-only, bounded (config-files.ts). `undefined` where no path is documented.
 */
export async function findGuidanceConfigEntry(host: HostId): Promise<FoundEntry | undefined> {
  return findMnemoverseEntry(homeConfigFiles(mcpConfigTargetFor(host).homePaths), (file, reason) =>
    log.warn(`Skipped ${file} while looking for an existing Mnemoverse entry (${reason})`),
  );
}

/** The sentence about signing in, per the host's `signIn` status. */
function signInSentence(app: string, t: McpConfigTarget): string {
  switch (t.signIn) {
    case "accepted":
      return `${app} signs you in to the hosted server through the browser the first time it connects.`;
    case "unverified":
      return `${app} should open the browser to sign you in the first time it connects; if it doesn't, see the setup guide.`;
    case "not-accepted":
      return `Mnemoverse doesn't accept ${app}'s sign-in yet, so the hosted server can't sign you in from ${app} for now; the setup guide has the current status.`;
  }
}

/**
 * The first-run / Sign In message, and the buttons that fit it:
 *
 *   - the user's config already has Mnemoverse → say where; nothing to do;
 *   - the editor's sign-in is refused today    → say so; only the guide;
 *   - guidance because the adapter failed      → say that, not "the editor can't";
 *   - otherwise                                → the editor can't; copy + paste.
 */
function guidanceMessage(): { text: string; buttons: string[] } {
  const app = appName();
  const t = target();
  const found = getConfiguredEntry();
  if (found) {
    const note = t.signIn === "not-accepted" ? ` ${signInSentence(app, t)}` : ` ${app} runs its sign-in; this extension has nothing to sign in.`;
    return {
      text: `Mnemoverse is already in your ${app} MCP config (${describeConfiguredEntry(found)}).${note}`,
      buttons: ["Open guide"],
    };
  }
  if (getHost().fallbackFrom) {
    return {
      text: `Mnemoverse couldn't add its MCP server in ${app} (details in "Mnemoverse: Show Log"). Copy a ready config for Mnemoverse and paste it into ${app}'s MCP config file instead.`,
      buttons: ["Copy config", "Open guide"],
    };
  }
  if (t.signIn === "not-accepted") {
    return {
      text: `${app} doesn't let extensions add MCP servers, and Mnemoverse doesn't accept ${app}'s sign-in yet, so memory can't be connected in ${app} for now. The setup guide has the current status.`,
      buttons: ["Open guide"],
    };
  }
  return {
    text: `${app} doesn't let extensions add MCP servers yet. Copy a ready config for Mnemoverse and paste it into its MCP config file.`,
    buttons: ["Copy config", "Open guide"],
  };
}

/** The toast with its buttons. Awaited by nobody on the activation path. */
async function showGuidanceToast(): Promise<void> {
  const { text, buttons } = guidanceMessage();
  const choice = await vscode.window.showInformationMessage(text, ...buttons);
  if (choice === "Copy config") {
    await vscode.commands.executeCommand("mnemoverse.copyMcpConfig");
  } else if (choice === "Open guide") {
    await openGuide();
  }
}

function openGuide(): Thenable<boolean> {
  return vscode.env.openExternal(vscode.Uri.parse(EDITORS_GUIDE_URL));
}

/**
 * First-run notice on a guidance host: once ever, persisted before showing.
 * Skipped when the user's config already has Mnemoverse — nothing to set up.
 */
export async function showGuidanceIntro(context: vscode.ExtensionContext): Promise<void> {
  if (getConfiguredEntry() || context.globalState.get<boolean>(GUIDANCE_SHOWN_KEY, false)) {
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
 * Sign Out on a guidance host. Whatever sign-in the editor's agent uses belongs
 * to the editor (its OAuth session for the server in its MCP config); this
 * extension holds none. `removedKey`: the caller deleted a key this extension
 * had stored, which nothing here used.
 */
export async function explainGuidanceSignOut(removedKey: boolean): Promise<void> {
  const app = appName();
  const found = getConfiguredEntry();
  const where = found ? describeConfiguredEntry(found) : `"mnemoverse" in ${target().file}`;
  const keyNote = removedKey
    ? " The unused key this extension had stored was removed from this device; it stays valid until you revoke it in the console."
    : "";
  const buttons = removedKey ? ["Open guide", "Open console"] : ["Open guide"];
  const choice = await vscode.window.showInformationMessage(
    `This extension holds no Mnemoverse sign-in in ${app}. ${app} keeps the sign-in for the server in its MCP config: sign out in ${app}'s MCP settings, or remove the entry ${where}.${keyNote}`,
    ...buttons,
  );
  if (choice === "Open guide") {
    await openGuide();
  } else if (choice === "Open console") {
    await vscode.env.openExternal(vscode.Uri.parse(CONSOLE_BASE_URL));
  }
}

/**
 * Set API Key on a guidance host: no server started by this extension would
 * read the key (the editor uses the hosted server with its own sign-in), so
 * storing it would only suggest that something changed. Nothing is stored.
 */
export async function explainKeyNotUsedInGuidance(): Promise<void> {
  const app = appName();
  const { buttons } = guidanceMessage();
  const text = getHost().fallbackFrom
    ? `Mnemoverse couldn't add its MCP server in ${app} (details in "Mnemoverse: Show Log"), so a key set here wouldn't be used. Nothing was saved.`
    : `${app} doesn't use a Mnemoverse API key from this extension: memory connects through the hosted server in ${app}'s MCP config, which signs you in itself. Nothing was saved.`;
  const choice = await vscode.window.showInformationMessage(text, ...buttons);
  if (choice === "Copy config") {
    await vscode.commands.executeCommand("mnemoverse.copyMcpConfig");
  } else if (choice === "Open guide") {
    await openGuide();
  }
}

/**
 * `mnemoverse.copyMcpConfig`: put the hosted-server snippet for this editor on
 * the clipboard and say where it goes.
 *
 * Where Mnemoverse is already in this editor — registered by this extension
 * (VS Code-family hosts, Cursor) or found in the user's own config — the
 * snippet is still copied (it is useful for other MCP clients), but the message
 * says which of the two it is and warns against adding it again, which would
 * list every tool twice.
 */
export async function copyMcpConfig(): Promise<void> {
  const host = getHost();
  const snippet = buildMcpConfigSnippet(host.id);
  await vscode.env.clipboard.writeText(snippet);
  log.info(`Copied the MCP config snippet for host "${host.id}"`);

  const app = appName();
  const found = getConfiguredEntry();
  if (found) {
    await vscode.window.showInformationMessage(
      `Copied an MCP config for Mnemoverse's hosted server. Mnemoverse is already in your ${app} MCP config (${describeConfiguredEntry(found)}), so don't add it again (every tool would appear twice); use the snippet in other MCP clients.`,
    );
    return;
  }
  if (isRegistered()) {
    await vscode.window.showInformationMessage(
      `Copied an MCP config for Mnemoverse's hosted server. This extension already adds Mnemoverse in ${app}, so don't also add the snippet to ${app}'s own config (every tool would appear twice); use it in other MCP clients.`,
    );
    return;
  }
  const t = mcpConfigTargetFor(host.id);
  const afterSave = t.afterSave ? ` After saving, ${t.afterSave}.` : "";
  const choice = await vscode.window.showInformationMessage(
    `Copied. Paste it into ${t.file}; if the file already lists servers, add the "mnemoverse" entry inside "${t.rootKey}".${afterSave} ${signInSentence(app, t)}`,
    "Open guide",
  );
  if (choice === "Open guide") {
    await openGuide();
  }
}
