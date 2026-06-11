import * as vscode from "vscode";
import * as os from "node:os";
import {
  generateState,
  generatePkce,
  deriveConfirmCode,
  buildRedirectUri,
  buildConnectUrl,
  parseCallback,
  EXCHANGE_URL,
  type ExchangeResponse,
} from "./signin-core";
import { storeApiKey, clearApiKey } from "./auth";

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

const TIMEOUT_MS = 10 * 60 * 1000; // matches the code TTL

function defaultKeyName(): string {
  const host = (() => {
    try {
      return os.hostname();
    } catch {
      return "this device";
    }
  })();
  const date = new Date().toISOString().slice(0, 10);
  return `VS Code — ${host} — ${date}`;
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
  const confirmCode = await deriveConfirmCode(state);

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
      title: `Finish signing in to Mnemoverse in your browser. Confirm the code matches: ${confirmCode}`,
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
  if (!pending || result.kind === "invalid" || result.state !== pending.state) {
    // Unsolicited or stale callback — any site can fire vscode:// URIs.
    console.warn("[mnemoverse] ignoring an unsolicited or mismatched sign-in callback");
    return;
  }
  const p = pending;
  if (result.kind === "error") {
    p.settle({ ok: false, reason: "denied" });
    return;
  }
  try {
    const data = await exchange(result.code, p.verifier);
    // The exchange burned the one-time code. If the attempt was cancelled /
    // timed out / superseded WHILE it was in flight, `pending` was cleared (or
    // replaced) — do NOT store a key for an attempt the user abandoned.
    if (pending !== p) return;
    await storeApiKey(p.context, data.api_key);
    p.fireServerChanged(); // make VS Code re-resolve + respawn the MCP server with the new key
    p.settle({ ok: true, email: data.email });
  } catch (err) {
    p.settle({ ok: false, reason: "exchange", detail: err instanceof Error ? err.message : String(err) });
  }
}

export async function signOut(
  context: vscode.ExtensionContext,
  fireServerChanged: () => void,
): Promise<void> {
  await clearApiKey(context);
  fireServerChanged();
  await vscode.window.showInformationMessage("Signed out of Mnemoverse.");
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
  const data = (await res.json()) as Partial<ExchangeResponse>;
  if (!data || typeof data.api_key !== "string" || data.api_key.length === 0) {
    // A 200 with an unexpected body must never store an empty/undefined key.
    throw new Error("invalid_response");
  }
  return data as ExchangeResponse;
}

function reportOutcome(o: Outcome): void {
  if (o.ok) {
    void vscode.window.showInformationMessage(
      `Signed in to Mnemoverse${o.email ? ` as ${o.email}` : ""} — memory connected.`,
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
      void vscode.window.showWarningMessage(
        'Mnemoverse sign-in timed out. Run "Mnemoverse: Sign In" to try again, or paste a key with "Set API Key".',
      );
      return;
    case "exchange":
      void vscode.window.showErrorMessage(
        o.detail === "invalid_grant"
          ? "Sign-in link expired or already used. Run “Mnemoverse: Sign In” again."
          : "Could not complete Mnemoverse sign-in. Please try again.",
      );
      console.error("[mnemoverse] sign-in exchange failed:", o.detail);
      return;
  }
}
