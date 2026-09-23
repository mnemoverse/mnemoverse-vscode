import * as vscode from "vscode";

/**
 * The "Mnemoverse" output channel (View → Output → Mnemoverse, or
 * "Mnemoverse: Show Log").
 *
 * Before 0.3.0 the extension logged only to the developer console, which is
 * invisible in a built editor — so on a fork where nothing worked, neither the
 * user nor a bug report could say why. The channel records host detection, the
 * adapter chosen, and every failure, which is what an issue report needs.
 *
 * NEVER log a key, a one-time code, a PKCE verifier or a callback query:
 * callers pass only fixed text, host facts and error messages. Error messages
 * here come from our own code paths (exchange error codes, fs errors) and carry
 * no secrets.
 *
 * Until `initLog` runs (and in unit tests without a channel), messages fall
 * back to the console so nothing is lost.
 */
/** The subset of LogOutputChannel we use, so a plain channel can stand in. */
interface Channel {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

let channel: Channel | undefined;

/**
 * Create the channel. Returns a disposable for context.subscriptions.
 *
 * This is the first thing activate() does, before the commands exist, so it
 * must not throw on any host: a fork without log channels (`{ log: true }`)
 * gets a plain channel with level prefixes, and a fork without output channels
 * at all gets the console fallback.
 */
export function initLog(): vscode.Disposable {
  try {
    const c = vscode.window.createOutputChannel("Mnemoverse", { log: true });
    if (typeof c?.info === "function") {
      channel = c;
    } else {
      c?.dispose?.();
    }
  } catch {
    // fall through to the plain channel
  }
  if (!channel) {
    try {
      const plain = vscode.window.createOutputChannel("Mnemoverse");
      const line = (level: string) => (message: string) =>
        plain.appendLine(`${new Date().toISOString()} [${level}] ${message}`);
      channel = {
        info: line("info"),
        warn: line("warning"),
        error: line("error"),
        show: (preserveFocus) => plain.show(preserveFocus),
        dispose: () => plain.dispose(),
      };
    } catch {
      channel = undefined; // console fallback below
    }
  }
  const created = channel;
  return new vscode.Disposable(() => {
    created?.dispose();
    if (channel === created) channel = undefined;
  });
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const log = {
  info(message: string): void {
    if (channel) channel.info(message);
    else console.log(`[mnemoverse] ${message}`);
  },
  warn(message: string): void {
    if (channel) channel.warn(message);
    else console.warn(`[mnemoverse] ${message}`);
  },
  error(message: string, err?: unknown): void {
    const text = err === undefined ? message : `${message}: ${detail(err)}`;
    if (channel) channel.error(text);
    else console.error(`[mnemoverse] ${text}`);
  },
  show(): void {
    channel?.show(true);
  },
};
