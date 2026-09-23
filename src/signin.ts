import * as vscode from "vscode";
import * as os from "node:os";
import {
  isWellFormedState,
  generateState,
  generatePkce,
  buildRedirectUri,
  buildConnectUrl,
  parseCallback,
  parseExchangeResponse,
  EXCHANGE_URL,
  type ExchangeResponse,
} from "./signin-core";
import { storeApiKey, clearApiKey } from "./auth";
import { resetConnectPrompt } from "./session";
import { appName, isRegistered } from "./state";
import { isNpxAvailable, promptNodeMissing } from "./node-check";
import { log } from "./log";

/**
 * Keyless browser sign-in (Route A). The user clicks "Sign In"; we open the
 * console in the browser; they approve; the console hands a one-time code back
 * via the editor's URI scheme; we exchange it (with our PKCE verifier) for the
 * real key and store it in SecretStorage. The user never sees an API key.
 *
 * The pure crypto/URL logic lives in signin-core.ts (unit-tested, byte-compatible
 * with the portal). This module is the VS Code-aware orchestration.
 */

type Outcome =
  | { ok: true; email: string }
  | { ok: false; reason: "cancelled" | "denied" | "timeout" | "superseded" | "exchange"; detail?: string };

interface Pending {
  state: string;
  verifier: string;
  context: vscode.ExtensionContext;
  fireServerChanged: () => void;
  settle: (o: Outcome) => void;
}

// Exactly one sign-in attempt in flight per extension host; a new attempt
// supersedes the old one. Any website can fire a vscode:// URI, so the `state`
// match is the CSRF gate for the callback.
let pending: Pending | undefined;

/**
 * How long the editor waits for the browser to come back. 30 minutes, not the
 * 10-minute code TTL: the portal starts the TTL when the code is CREATED (after
 * the user approves), while this timer starts when Sign In is clicked. A new
 * user who creates an account and verifies email first can take well over 10
 * minutes before the code even exists; with a 10-minute timer their valid
 * callback arrived after the extension had given up and was silently dropped.
 * The server-side TTL and PKCE remain the security boundary; this is only how
 * long the progress notification stays up.
 */
export const TIMEOUT_MS = 30 * 60 * 1000;

/** The console, where keys are listed and revoked. */
const CONSOLE_URL = "https://console.mnemoverse.com";

/** True while the "sign-in expired" notice is on screen, so repeated URIs can't stack toasts. */
let lateNoticeOpen = false;

/**
 * States of attempts that already signed in this session. A browser or OS that
 * delivers the same callback URI twice must not follow a success with a
 * "sign-in expired" notice.
 */
const completedStates = new Set<string>();

/**
 * Name for the key the console mints, shown in the console's key list. Uses
 * the editor's own name ("Cursor — host — date", "VSCodium — …") rather than a
 * hard-coded "VS Code", so a user with several editors can tell keys apart.
 */
function defaultKeyName(): string {
  const host = (() => {
    try {
      return os.hostname();
    } catch {
      return "this device";
    }
  })();
  const date = new Date().toISOString().slice(0, 10);
  return `${appName()} — ${host} — ${date}`;
}

export async function signIn(
  context: vscode.ExtensionContext,
  fireServerChanged: () => void,
): Promise<void> {
  // Supersede any in-flight attempt.
  if (pending) {
    pending.settle({ ok: false, reason: "superseded" });
    pending = undefined;
  }

  const state = generateState();
  const { verifier, challenge } = await generatePkce();
  const scheme = vscode.env.uriScheme;
  const redirectUri = buildRedirectUri(scheme);
  const url = buildConnectUrl({
    state,
    redirectUri,
    codeChallenge: challenge,
    name: defaultKeyName(),
    editor: scheme,
  });

  // Arm the attempt (pending + timer + outcome promise) BEFORE opening the
  // browser, so a very fast callback isn't dropped and an openExternal failure
  // can't leave a stale pending behind.
  let done = false;
  let resolveOutcome!: (o: Outcome) => void;
  const outcomePromise = new Promise<Outcome>((r) => {
    resolveOutcome = r;
  });
  const settle = (o: Outcome) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (pending && pending.state === state) pending = undefined;
    resolveOutcome(o);
  };
  const timer = setTimeout(() => settle({ ok: false, reason: "timeout" }), TIMEOUT_MS);
  pending = { state, verifier, context, fireServerChanged, settle };

  try {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  } catch {
    settle({ ok: false, reason: "exchange", detail: "could not open the browser" });
  }

  const outcome = await vscode.window.withProgress<Outcome>(
    {
      location: vscode.ProgressLocation.Notification,
      // No confirm-code to compare: security is carried by PKCE + state match +
      // the redirect allowlist + the session-gated mint on the real console
      // domain. The user just approves on the consent page. If the browser
      // can't hand the code back automatically, the page offers a paste fallback
      // wired to the "Mnemoverse: Complete sign-in" command.
      title: "Finishing Mnemoverse sign-in in your browser…",
      cancellable: true,
    },
    (_progress, token) => {
      token.onCancellationRequested(() => settle({ ok: false, reason: "cancelled" }));
      return outcomePromise;
    },
  );

  reportOutcome(outcome);
}

/**
 * Handle the vscode://…/auth-callback URI. Registered as the extension's
 * UriHandler. Validates the state against the in-flight attempt (drops anything
 * unsolicited), then exchanges the code for the key.
 */
export async function handleUri(uri: vscode.Uri): Promise<void> {
  const result = parseCallback(uri.query);
  if (
    !pending &&
    result.kind === "code" &&
    isWellFormedState(result.state) &&
    !completedStates.has(result.state)
  ) {
    // A well-formed callback with nothing waiting for it: almost always the
    // user approving in the browser after this editor's wait expired (or after
    // a restart, which drops the in-memory PKCE verifier). The code cannot be
    // redeemed without that verifier, so say so and offer a fresh start
    // instead of dropping it silently. Nothing from the URI is used or logged.
    log.warn("A sign-in callback arrived with no sign-in in progress (expired or from an earlier session)");
    void showLateCallbackNotice();
    return;
  }
  if (!pending || result.kind === "invalid" || result.state !== pending.state) {
    // Unsolicited or stale callback — any site can fire vscode:// URIs.
    log.warn("Ignoring an unsolicited or mismatched sign-in callback");
    return;
  }
  const p = pending;
  if (result.kind === "error") {
    p.settle({ ok: false, reason: "denied" });
    return;
  }
  await redeemCode(p, result.code);
}

/**
 * Redeem a one-time code against an in-flight attempt's PKCE verifier, store the
 * key, and settle the attempt. Shared by the automatic `vscode://` callback
 * (handleUri) and the manual paste fallback (completeSignIn) — same exchange,
 * the code just arrives via a different transport.
 */
async function redeemCode(p: Pending, code: string): Promise<void> {
  try {
    const data = await exchange(code, p.verifier);
    // The exchange burned the one-time code. If the attempt was cancelled /
    // timed out / superseded WHILE it was in flight, `pending` was cleared (or
    // replaced) — do NOT store a key for an attempt the user abandoned.
    if (pending !== p) return;
    await storeApiKey(p.context, data.api_key);
    completedStates.add(p.state);
    p.fireServerChanged(); // make VS Code re-resolve + respawn the MCP server with the new key
    p.settle({ ok: true, email: data.email });
  } catch (err) {
    p.settle({ ok: false, reason: "exchange", detail: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Manual fallback for when the browser can't hand the code back automatically
 * (no `vscode://` handler registered, remote/SSH sessions, a browser that blocks
 * custom schemes). The consent page shows the one-time code and tells the user
 * to run this command; they paste it here and we redeem it with the in-flight
 * attempt's PKCE verifier. Requires an active Sign In — the verifier lives only
 * in `pending`, never on disk. The wrong code (e.g. from another flow) fails the
 * PKCE check server-side, so pasting is safe.
 */
export async function completeSignIn(): Promise<void> {
  const p = pending;
  if (!p) {
    await vscode.window.showInformationMessage(
      'No Mnemoverse sign-in is in progress. Run "Mnemoverse: Sign In" first, then paste the code from the browser.',
    );
    return;
  }
  const entered = await vscode.window.showInputBox({
    title: "Complete Mnemoverse sign-in",
    prompt: "Paste the code shown on the Mnemoverse connect page in your browser.",
    placeHolder: "code from console.mnemoverse.com",
    ignoreFocusOut: true,
    validateInput: (v) => (v.trim().length === 0 ? "Paste the code from the browser" : undefined),
  });
  if (!entered) {
    return; // user dismissed the box — leave the attempt running for the auto-callback
  }
  // redeemCode settles `pending`, which resolves the in-flight signIn's progress
  // notification → reportOutcome fires there. No second report here.
  await redeemCode(p, entered.trim());
}

/**
 * "This sign-in finished after the request expired" — at most one on screen at
 * a time, so a page (or a hostile site) firing the URI repeatedly cannot stack
 * notifications.
 */
async function showLateCallbackNotice(): Promise<void> {
  if (lateNoticeOpen) {
    return;
  }
  lateNoticeOpen = true;
  try {
    const choice = await vscode.window.showWarningMessage(
      "This sign-in finished after the request expired — run Sign In again.",
      "Sign In",
    );
    if (choice === "Sign In") {
      await vscode.commands.executeCommand("mnemoverse.signIn");
    }
  } finally {
    lateNoticeOpen = false;
  }
}

/**
 * Sign out on this device: forget the stored key and stop the server using it.
 *
 * The key itself stays valid on the server — there is no self-revoke endpoint
 * yet — so the message says so and links the console where it can be revoked.
 * Saying only "Signed out" would suggest the key is gone.
 */
export async function signOut(
  context: vscode.ExtensionContext,
  fireServerChanged: () => void,
): Promise<void> {
  await clearApiKey(context);
  // Re-arm the one-click connect toast: a deliberate sign-out means the user
  // may want to reconnect (e.g. switch accounts) in the same session, and the
  // session guard would otherwise suppress the actionable toast.
  resetConnectPrompt();
  fireServerChanged();
  const choice = await vscode.window.showInformationMessage(
    "Signed out of Mnemoverse on this device. The key stays valid until you revoke it in the console.",
    "Open console",
  );
  if (choice === "Open console") {
    await vscode.env.openExternal(vscode.Uri.parse(CONSOLE_URL));
  }
}

async function exchange(code: string, verifier: string): Promise<ExchangeResponse> {
  const res = await fetch(EXCHANGE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });
  if (!res.ok) {
    let errCode = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) errCode = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(errCode);
  }
  // Validate the shape before trusting it (tested in signin-core).
  return parseExchangeResponse(await res.json());
}

function reportOutcome(o: Outcome): void {
  if (o.ok) {
    const who = `Signed in to Mnemoverse${o.email ? ` as ${o.email}` : ""}`;
    // "Connected" only when something will actually use the key: the lm
    // provider is registered AND the local server can start. Otherwise report
    // the sign-in alone and, if Node is the gap, say how to close it.
    if (!isNpxAvailable()) {
      void vscode.window.showInformationMessage(`${who}.`);
      void promptNodeMissing();
      return;
    }
    void vscode.window.showInformationMessage(
      isRegistered() ? `${who} — memory connected in ${appName()}.` : `${who}.`,
    );
    return;
  }
  switch (o.reason) {
    case "cancelled":
    case "superseded":
      return; // user-initiated; stay quiet
    case "denied":
      void vscode.window.showInformationMessage("Mnemoverse sign-in was cancelled in the browser.");
      return;
    case "timeout":
      void showTimeoutNotice();
      return;
    case "exchange":
      void vscode.window.showErrorMessage(
        o.detail === "invalid_grant"
          ? "Sign-in link expired or already used. Run “Mnemoverse: Sign In” again."
          : "Could not complete Mnemoverse sign-in. Please try again.",
      );
      // `detail` is an error code from the exchange (e.g. invalid_grant,
      // http_502) or a local message — never the code or the key.
      log.error("Sign-in exchange failed", o.detail);
      return;
  }
}

/** Timeout: offer the two ways forward the portal contract promises (Retry / Paste key). */
async function showTimeoutNotice(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Mnemoverse sign-in timed out before the browser came back.",
    "Try again",
    "Paste key",
  );
  if (choice === "Try again") {
    await vscode.commands.executeCommand("mnemoverse.signIn");
  } else if (choice === "Paste key") {
    await vscode.commands.executeCommand("mnemoverse.setApiKey");
  }
}
