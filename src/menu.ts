import * as vscode from "vscode";
import { EDITORS_GUIDE_URL, canBrowserSignIn, mcpConfigTargetFor } from "./hosts";
import { localDay } from "./rating-core";
import { appName, describeState, getConnectionMode, getHost, hasKey } from "./state";
import { openCursorMcpSettings } from "./cursor";
import { explainGuidance } from "./guidance";
import { log } from "./log";

/**
 * Small user actions behind the status bar menu, the walkthrough and their
 * palette commands. Each is host-aware: the same command does the right thing
 * in VS Code, Cursor, or an editor that needs a config entry, and never
 * pretends a step happened when it could not.
 */

/** Fully qualified walkthrough id: `<publisher>.<name>#<walkthrough id>`. */
export const WALKTHROUGH_ID = "Mnemoverse.mnemoverse-vscode#mnemoverse.getStarted";

/**
 * The first memory the walkthrough suggests. It must be TRUE: it goes into the
 * user's permanent memory, shared with every connected tool, and the bundled
 * skill tells agents to act on what they recall — there is no delete tool to
 * take back a made-up preference (the earlier example, "I prefer Railway for
 * deployments", would have steered every later deploy question). So the
 * test fact is the setup itself: the editor and today's date (local calendar
 * day, YYYY-MM-DD, from rating-core). An agent without memory cannot guess the
 * answer to the follow-up, so a correct answer really shows recall.
 */
export function tryItPrompt(app: string, now = Date.now()): string {
  return `Remember that I set up Mnemoverse memory in ${app} on ${localDay(now)}.`;
}
export const TRY_IT_FOLLOW_UP = "When and where did I set up Mnemoverse memory?";

interface MenuItem extends vscode.QuickPickItem {
  run?: () => Thenable<unknown>;
}

function commandItem(label: string, command: string, detail?: string): MenuItem {
  return { label, detail, run: () => vscode.commands.executeCommand(command) };
}

function separator(label: string): MenuItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

/** The actions that make sense for this host and state, most relevant first. */
export function buildMenuItems(): MenuItem[] {
  const host = getHost();
  const items: MenuItem[] = [];
  switch (host.kind) {
    case "lm":
      if (getConnectionMode() === "hosted") {
        items.push(
          commandItem("$(server-process) Use local connection", "mnemoverse.useLocalConnection", "Run the server with npx on this machine; sign in with a key"),
        );
        // The hosted connection doesn't use a stored key, but switching to it
        // doesn't delete one either; let the user remove it from here.
        if (hasKey()) {
          items.push(
            commandItem("$(trash) Remove stored key", "mnemoverse.clearApiKey", "The key kept for the local connection; the hosted connection doesn't use it"),
          );
        }
      } else {
        items.push(
          hasKey()
            ? commandItem("$(sign-out) Sign Out", "mnemoverse.signOut")
            : canBrowserSignIn(vscode.env.uriScheme)
              ? commandItem("$(sign-in) Sign In", "mnemoverse.signIn", "Connect your memory through the browser")
              : commandItem("$(key) Set API Key", "mnemoverse.setApiKey", `Browser sign-in isn't available in ${appName()} yet; paste a key from the console`),
          commandItem("$(cloud) Use hosted connection", "mnemoverse.useHostedConnection", "No Node.js; the editor signs you in on first use"),
        );
      }
      break;
    case "cursor":
      items.push(commandItem("$(sign-in) Open MCP settings to sign in", "mnemoverse.openMcpSettings"));
      break;
    case "guidance":
      // Where the editor's sign-in is refused today (Antigravity), a config
      // entry cannot connect yet; lead with the guide, which has the status.
      if (mcpConfigTargetFor(host.id).signIn !== "not-accepted") {
        items.push(commandItem("$(clippy) Copy MCP config", "mnemoverse.copyMcpConfig", `For ${appName()}'s MCP config file`));
      }
      items.push({ label: "$(book) Open setup guide", run: () => vscode.env.openExternal(vscode.Uri.parse(EDITORS_GUIDE_URL)) });
      break;
  }
  items.push(
    separator("Help"),
    commandItem("$(rocket) Get started", "mnemoverse.getStarted"),
    commandItem("$(book) Open documentation", "mnemoverse.openDocs"),
    commandItem("$(output) Show log", "mnemoverse.showLog"),
    separator("Support Mnemoverse"),
    commandItem("$(star-empty) Rate Mnemoverse", "mnemoverse.rate"),
    commandItem("$(github) Star on GitHub", "mnemoverse.starOnGitHub"),
  );
  return items;
}

/** `mnemoverse.showMenu` — what the status bar item opens. */
export async function showMenu(): Promise<void> {
  const { label, detail } = describeState();
  const picked = await vscode.window.showQuickPick(buildMenuItems(), {
    title: `Mnemoverse Memory: ${label}`,
    placeHolder: detail,
  });
  if (picked?.run) {
    await picked.run();
  }
}

/** `mnemoverse.getStarted` — open the walkthrough; fall back to the docs where walkthroughs are missing. */
export async function openGetStarted(): Promise<void> {
  try {
    await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH_ID, false);
  } catch (err) {
    log.warn(`Walkthrough unavailable (${err instanceof Error ? err.message : String(err)}); opening the guide instead`);
    await vscode.env.openExternal(vscode.Uri.parse(EDITORS_GUIDE_URL));
  }
}

/**
 * `mnemoverse.tryIt` — put a first memory prompt in front of the user.
 *
 * On lm hosts: `workbench.action.chat.open` with `{ query, isPartialQuery,
 * mode }`, the argument shape VS Code's own welcome page uses
 * (IChatViewOpenOptions; `mode` has existed since 1.102). `isPartialQuery`
 * fills the input without sending, so the user sees exactly what the agent will
 * store and presses Enter themselves. If the command or the argument shape is
 * not accepted, plain `workbench.action.chat.open` plus the written steps.
 * Elsewhere (Cursor's composer, other agents) there is no stable command, so the
 * steps are shown with a "Copy prompt" button.
 */
export async function tryIt(): Promise<void> {
  const app = appName();
  const prompt = tryItPrompt(app);
  if (getHost().kind === "lm") {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query: prompt,
        isPartialQuery: true,
        mode: "agent",
      });
      return;
    } catch (err) {
      log.warn(`Opening chat with a prompt failed: ${err instanceof Error ? err.message : String(err)}`);
      try {
        await vscode.commands.executeCommand("workbench.action.chat.open");
      } catch {
        // No chat view at all: the written steps below are all we can offer.
      }
    }
  }
  const choice = await vscode.window.showInformationMessage(
    `Open the agent chat in ${app} and send: "${prompt}" Then start a new chat and ask "${TRY_IT_FOLLOW_UP}" If the agent answers with that date and ${app}, memory is working.`,
    "Copy prompt",
  );
  if (choice === "Copy prompt") {
    await vscode.env.clipboard.writeText(prompt);
  }
}

/**
 * `mnemoverse.openMcpSettings` — where this editor manages MCP servers and
 * their sign-in: Cursor's settings tab; VS Code's "MCP: List Servers"; on
 * guidance hosts the config-file guidance, since there is no settings page we
 * can open for them.
 */
export async function openMcpSettings(): Promise<void> {
  switch (getHost().kind) {
    case "cursor":
      await openCursorMcpSettings();
      return;
    case "lm":
      try {
        await vscode.commands.executeCommand("workbench.mcp.listServer");
      } catch (err) {
        log.warn(`"MCP: List Servers" unavailable: ${err instanceof Error ? err.message : String(err)}`);
        await vscode.window.showInformationMessage(
          `Open the Command Palette in ${appName()} and run "MCP: List Servers" to see Mnemoverse Memory.`,
        );
      }
      return;
    case "guidance":
      await explainGuidance();
      return;
  }
}

/**
 * `mnemoverse.useHostedConnection` / `mnemoverse.useLocalConnection` — flip
 * `mnemoverse.connection` in user settings. The configuration listener in
 * extension.ts fires the provider's change event, so the editor swaps servers
 * without a reload.
 */
export async function setConnectionMode(mode: "local" | "hosted"): Promise<void> {
  await vscode.workspace
    .getConfiguration("mnemoverse")
    .update("connection", mode, vscode.ConfigurationTarget.Global);
  const app = appName();
  if (getHost().kind !== "lm") {
    await vscode.window.showInformationMessage(
      `Saved. This setting applies only in editors that support VS Code's MCP API; the setup for ${app} always uses the hosted server.`,
    );
    return;
  }
  await vscode.window.showInformationMessage(
    mode === "hosted"
      ? `Mnemoverse now uses the hosted server: no Node.js needed. The first time the agent uses memory, ${app} asks you to sign in through the browser.`
      : hasKey()
        ? "Mnemoverse now runs the local server with npx (Node.js 18+), using your stored key."
        : 'Mnemoverse now runs the local server with npx (Node.js 18+). Run "Mnemoverse: Sign In" to connect it.',
  );
}
