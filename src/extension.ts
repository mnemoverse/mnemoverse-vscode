import * as vscode from "vscode";
import { registerProvider } from "./provider";
import { clearApiKey, promptForApiKey, storeApiKey } from "./auth";
import { signIn, signOut, handleUri, completeSignIn } from "./signin";
import { promptConnect } from "./prompts";
import { wasConnectPromptShown } from "./session";
import { decideShowWelcome } from "./signin-core";
import { detectHostKind, identifyHost, type HostProbe } from "./hosts";
import { initLog, log } from "./log";
import {
  appName,
  getConnectionMode,
  getHost,
  hasKey,
  initStatusBar,
  isAlreadyConfigured,
  publish,
  refreshKeyState,
  setHost,
  setRegistered,
  type HostInfo,
} from "./state";
import { confirmSetKeyInCursor, explainCursorSignIn, showCursorIntro, startCursorAdapter } from "./cursor";
import { copyMcpConfig, explainGuidance, showGuidanceIntro } from "./guidance";
import { openGetStarted, openMcpSettings, setConnectionMode, showMenu, tryIt } from "./menu";
import { openGitHubRepo, openRatingPage, recordRatingActivation, scheduleRatingPrompt } from "./rating";

/** globalState flag: the first-run welcome has been shown once (ever). */
const WELCOME_SHOWN_KEY = "mnemoverse.welcomeShown";

const DOCS_URL = "https://mnemoverse.com/docs/api/mcp-server";

/**
 * Extension entry point, called after `onStartupFinished` (or `onUri` /
 * a command).
 *
 * ORDER IS THE FAULT ISOLATION (0.3.0). In 0.2.x the MCP provider was
 * registered inside the same `subscriptions.push(...)` argument list as the
 * commands, before them; on a host without `vscode.lm` that call threw and
 * nothing else registered — every palette entry failed with "command not
 * found" and the sign-in callback had no handler. Now:
 *
 *   1. The "Mnemoverse" output channel, so everything after can be logged.
 *   2. The server-changed EventEmitter, pushed to subscriptions before anything
 *      that can throw (it can never leak).
 *   3. The URI handler and EVERY command. Nothing host-specific runs before
 *      these exist, so they work on any host, whatever happens next.
 *   4. The status bar item and the configuration listener.
 *   5. Host detection (hosts.ts) and the adapter it picks — lm, cursor or
 *      guidance — inside try/catch. Any failure falls back to guidance mode
 *      (honest setup help, nothing claimed), and the commands keep working.
 *   6. The first-run message for that adapter, and the delayed rating check.
 *
 * Returns a promise that settles once the adapter has started; it never
 * rejects. Toasts are fire-and-forget: activation never waits on the user.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(initLog());

  // Fired after sign-in / sign-out and on a connection-mode change, so the
  // editor re-resolves the MCP server with the new key or transport.
  const serverChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(serverChanged);
  const onKeyChanged = (): void => {
    serverChanged.fire();
    void refreshKeyState(context);
  };

  context.subscriptions.push(
    // Browser keyless sign-in returns here via <scheme>://mnemoverse.mnemoverse-vscode/auth-callback.
    vscode.window.registerUriHandler({
      handleUri: (uri) => {
        void handleUri(uri);
      },
    }),
    ...registerCommands(context, onKeyChanged),
  );

  try {
    context.subscriptions.push(initStatusBar());
  } catch (err) {
    log.error("Could not create the status bar item", err);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("mnemoverse.connection")) {
        log.info(`Connection mode changed to "${getConnectionMode()}"`);
        serverChanged.fire();
        publish();
      } else if (e.affectsConfiguration("mnemoverse.showStatusBar")) {
        publish();
      }
    }),
  );

  const kind = await startHostAdapter(context, serverChanged.event);
  void showFirstRun(context, kind);

  try {
    await recordRatingActivation(context);
    context.subscriptions.push(scheduleRatingPrompt(context));
  } catch (err) {
    log.error("Could not update the rating state", err);
  }
}

export function deactivate(): void {
  // Everything (channel, emitter, handlers, status bar, rating timer) is in
  // context.subscriptions, which the editor disposes.
}

/** What this editor exposes, read defensively (a fork may omit any of it). */
function probeHost(): HostProbe {
  const api = vscode as unknown as {
    lm?: { registerMcpServerDefinitionProvider?: unknown };
    cursor?: { mcp?: { registerServer?: unknown } };
  };
  return {
    appName: vscode.env.appName ?? "",
    uriScheme: vscode.env.uriScheme ?? "",
    hasLmProvider: typeof api.lm?.registerMcpServerDefinitionProvider === "function",
    hasCursorMcpApi: typeof api.cursor?.mcp?.registerServer === "function",
  };
}

/**
 * Detect the host, start its adapter, and record what it achieved. Any error
 * lands in guidance mode. Returns the adapter kind that is actually in effect.
 */
async function startHostAdapter(
  context: vscode.ExtensionContext,
  onDidChange: vscode.Event<void>,
): Promise<HostInfo["kind"]> {
  let host: HostInfo;
  try {
    const probe = probeHost();
    host = { id: identifyHost(probe), kind: detectHostKind(probe), appName: probe.appName };
    log.info(
      `Host "${probe.appName}" (uriScheme "${probe.uriScheme}", API ${vscode.version}): ` +
        `lm provider ${probe.hasLmProvider ? "present" : "absent"}, ` +
        `cursor.mcp ${probe.hasCursorMcpApi ? "present" : "absent"} → recognised as "${host.id}", adapter "${host.kind}"`,
    );
  } catch (err) {
    log.error("Host detection failed; using setup guidance", err);
    host = { id: "unknown", kind: "guidance", appName: vscode.env.appName ?? "" };
  }
  setHost(host);
  await refreshKeyState(context);

  try {
    switch (host.kind) {
      case "lm":
        context.subscriptions.push(registerProvider(context, onDidChange));
        setRegistered(true);
        log.info(`Registered the MCP server provider (connection: ${getConnectionMode()})`);
        break;
      case "cursor": {
        const result = await startCursorAdapter();
        setRegistered(result.registered, result.alreadyConfigured);
        break;
      }
      case "guidance":
        setRegistered(false);
        log.info("No extension MCP API to use here; offering the config snippet instead");
        break;
    }
    return host.kind;
  } catch (err) {
    log.error(`The "${host.kind}" adapter failed to start; falling back to setup guidance`, err);
    setHost({ ...host, kind: "guidance", fallbackFrom: host.kind });
    setRegistered(false);
    return "guidance";
  }
}

/**
 * One first-run message per adapter (each is once ever, persisted):
 *   - lm, local  → the Sign In welcome (only if no key and nothing else toasted);
 *   - lm, hosted → none: the editor's own OAuth prompt appears on first use;
 *   - cursor     → where the server went and how to sign in (skipped when the
 *                  user's own Cursor config already had Mnemoverse);
 *   - guidance   → "<app> doesn't let extensions add MCP servers yet" + Copy config.
 */
async function showFirstRun(context: vscode.ExtensionContext, kind: HostInfo["kind"]): Promise<void> {
  try {
    switch (kind) {
      case "lm":
        if (getConnectionMode() === "local") {
          await showWelcome(context);
        }
        return;
      case "cursor":
        // Nothing to announce when the user's own Cursor config already had it.
        if (!isAlreadyConfigured()) {
          await showCursorIntro(context);
        }
        return;
      case "guidance":
        await showGuidanceIntro(context);
        return;
    }
  } catch (err) {
    log.error("First-run message failed", err);
  }
}

/**
 * First-run welcome on lm hosts: if no key is stored and it was never shown,
 * offer the one-click keyless Sign In. `peekApiKey` (inside refreshKeyState)
 * never prompts, so this cannot pop a paste box. The flag is persisted BEFORE
 * the toast so it shows once ever; the agent-touch path in provider.ts still
 * catches an unconnected user when they reach for memory.
 */
async function showWelcome(context: vscode.ExtensionContext): Promise<void> {
  await refreshKeyState(context);
  const shownBefore = context.globalState.get<boolean>(WELCOME_SHOWN_KEY, false);
  // decideShowWelcome folds in wasConnectPromptShown() so we never double with
  // the provider's agent-touch toast. When it returns false for THAT reason the
  // persisted flag stays UNSET, keeping the welcome's one-time turn for a later
  // session. (promptConnect also self-guards.)
  if (!decideShowWelcome(hasKey(), shownBefore, wasConnectPromptShown())) {
    return;
  }
  await context.globalState.update(WELCOME_SHOWN_KEY, true);
  await promptConnect(
    `Welcome to Mnemoverse. Sign in from your browser to connect memory to the agent in ${appName()}.`,
  );
}

/**
 * Every command the manifest declares (a test checks the two lists match).
 * Each handler is wrapped so an unexpected error surfaces as a visible message
 * instead of being swallowed by the command runner.
 */
function registerCommands(context: vscode.ExtensionContext, onKeyChanged: () => void): vscode.Disposable[] {
  const handlers: Record<string, () => Thenable<unknown>> = {
    "mnemoverse.signIn": async () => {
      switch (getHost().kind) {
        case "cursor":
          return explainCursorSignIn();
        case "guidance":
          return explainGuidance();
        case "lm":
          if (getConnectionMode() === "hosted") {
            return explainHostedSignIn();
          }
          return signIn(context, onKeyChanged);
      }
    },
    "mnemoverse.completeSignIn": async () => {
      switch (getHost().kind) {
        case "cursor":
          return explainCursorSignIn();
        case "guidance":
          return explainGuidance();
        case "lm":
          return completeSignIn();
      }
    },
    "mnemoverse.signOut": () => signOut(context, onKeyChanged),
    "mnemoverse.setApiKey": async () => {
      if (getHost().kind === "cursor" && !(await confirmSetKeyInCursor())) {
        return;
      }
      // Prompt FIRST; only a valid entry replaces the stored key. Escape
      // leaves the existing key (and the running server) untouched.
      const key = await promptForApiKey();
      if (!key) {
        return;
      }
      await storeApiKey(context, key);
      onKeyChanged();
      await vscode.window.showInformationMessage(
        getHost().kind === "lm" && getConnectionMode() === "hosted"
          ? "Mnemoverse API key saved. It is used by the local connection; you are on the hosted connection."
          : "Mnemoverse API key saved.",
      );
    },
    "mnemoverse.clearApiKey": async () => {
      await clearApiKey(context);
      onKeyChanged();
      await vscode.window.showInformationMessage("Mnemoverse API key cleared.");
    },
    "mnemoverse.openDocs": () => vscode.env.openExternal(vscode.Uri.parse(DOCS_URL)),
    "mnemoverse.copyMcpConfig": () => copyMcpConfig(),
    "mnemoverse.openMcpSettings": () => openMcpSettings(),
    "mnemoverse.showMenu": () => showMenu(),
    "mnemoverse.getStarted": () => openGetStarted(),
    "mnemoverse.tryIt": () => tryIt(),
    "mnemoverse.useHostedConnection": () => setConnectionMode("hosted"),
    "mnemoverse.useLocalConnection": () => setConnectionMode("local"),
    "mnemoverse.showLog": async () => log.show(),
    "mnemoverse.rate": () => openRatingPage(context),
    "mnemoverse.starOnGitHub": () => openGitHubRepo(),
  };

  return Object.entries(handlers).map(([id, run]) =>
    vscode.commands.registerCommand(id, async () => {
      try {
        await run();
      } catch (err) {
        await showCommandError(COMMAND_ERROR_TITLES[id] ?? "Mnemoverse command failed", err);
      }
    }),
  );
}

/** Titles for the error toast; the detail goes to the log only. */
const COMMAND_ERROR_TITLES: Record<string, string> = {
  "mnemoverse.signIn": "Failed to sign in to Mnemoverse",
  "mnemoverse.completeSignIn": "Failed to complete Mnemoverse sign-in",
  "mnemoverse.signOut": "Failed to sign out of Mnemoverse",
  "mnemoverse.setApiKey": "Failed to set Mnemoverse API key",
  "mnemoverse.clearApiKey": "Failed to clear Mnemoverse API key",
  "mnemoverse.openDocs": "Failed to open Mnemoverse documentation",
  "mnemoverse.copyMcpConfig": "Failed to copy the Mnemoverse MCP config",
};

/**
 * Sign In while on the hosted connection: there is no key to mint — the editor
 * runs its own OAuth when the agent first uses a Mnemoverse tool.
 */
async function explainHostedSignIn(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    `With the hosted connection, ${appName()} signs you in itself: the first time the agent uses a Mnemoverse tool, it opens the browser. "Sign In" here is for the local connection.`,
    "Use local connection",
  );
  if (choice === "Use local connection") {
    await setConnectionMode("local");
  }
}

/**
 * Surface a command failure with a generic title; the detail goes to the
 * output channel only, so internal messages (paths, SDK internals) never reach
 * the toast. Typical causes: a locked OS keychain (SecretStorage throws), no
 * default browser (openExternal throws), clipboard unavailable.
 */
async function showCommandError(title: string, err: unknown): Promise<void> {
  log.error(title, err);
  await vscode.window.showErrorMessage(`${title}. See "Mnemoverse: Show Log" for details.`);
}
