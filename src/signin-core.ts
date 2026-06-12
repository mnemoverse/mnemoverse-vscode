/**
 * Keyless sign-in — pure, VS Code-free core (so it unit-tests in node).
 *
 * Mirrors the portal contract (mnemoverse-portal docs/TASK-KEYLESS-SIGNIN-CONTRACT.md
 * §2/§5/§7). The crypto here MUST stay byte-for-byte compatible with the portal:
 * PKCE S256 and the confirm-code formula are cross-side contracts (the portal
 * pins a golden vector — keep this side matching it).
 *
 * Uses node:crypto webcrypto so it is typed without the DOM lib and runs in both
 * the VS Code extension host (Node 20+) and vitest.
 */
import { webcrypto as crypto } from "node:crypto";

export const CONSOLE_BASE_URL = "https://console.mnemoverse.com";
export const CONNECT_PATH = "/connect/vscode";
export const EXCHANGE_URL = `${CONSOLE_BASE_URL}/api/connect/exchange`;
// Lowercased — VS Code lowercases the URI authority before dispatching to the
// UriHandler, and the portal allowlist matches this exact value.
export const REDIRECT_AUTHORITY = "mnemoverse.mnemoverse-vscode";
export const REDIRECT_PATH = "/auth-callback";

export function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 32 CSPRNG bytes (256-bit) as unpadded base64url. */
export function generateState(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return base64urlEncode(b);
}

const enc = new TextEncoder();

async function sha256(input: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(input)));
}

/** PKCE S256: a fresh verifier + its base64url(SHA-256) challenge. */
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const v = new Uint8Array(32);
  crypto.getRandomValues(v);
  const verifier = base64urlEncode(v);
  const challenge = base64urlEncode(await sha256(verifier));
  return { verifier, challenge };
}

export function buildRedirectUri(uriScheme: string): string {
  return `${uriScheme}://${REDIRECT_AUTHORITY}${REDIRECT_PATH}`;
}

export function buildConnectUrl(opts: {
  state: string;
  redirectUri: string;
  codeChallenge: string;
  name: string;
  editor: string;
}): string {
  const u = new URL(CONSOLE_BASE_URL + CONNECT_PATH);
  u.searchParams.set("state", opts.state);
  u.searchParams.set("redirect_uri", opts.redirectUri);
  u.searchParams.set("code_challenge", opts.codeChallenge);
  u.searchParams.set("name", opts.name);
  u.searchParams.set("editor", opts.editor);
  return u.toString();
}

export type CallbackResult =
  | { kind: "code"; code: string; state: string }
  | { kind: "error"; error: string; state: string }
  | { kind: "invalid" };

/** Parse the `vscode://…/auth-callback?…` query into code+state / error+state. */
export function parseCallback(query: string): CallbackResult {
  const q = new URLSearchParams(query);
  const state = q.get("state") ?? "";
  const code = q.get("code");
  const error = q.get("error");
  if (code) return { kind: "code", code, state };
  if (error) return { kind: "error", error, state };
  return { kind: "invalid" };
}

export interface ExchangeResponse {
  api_key: string;
  key_prefix: string;
  organization_id: string;
  tier: string;
  email: string;
  contract_version: number;
}

export const KEY_PREFIX = "mk_live_";

/**
 * Validate + trim a key before it is persisted. Mirrors getApiKey's paste-flow
 * check so a malformed value (from any source — a buggy server, a corrupt body)
 * can never land in SecretStorage and cause silent auth failures later.
 */
export function normalizeApiKey(key: string): string {
  const trimmed = (key ?? "").trim();
  // Require the prefix AND a non-empty suffix — a bare "mk_live_" is not a key.
  if (!trimmed.startsWith(KEY_PREFIX) || trimmed.length <= KEY_PREFIX.length) {
    throw new Error("invalid_key_format");
  }
  return trimmed;
}

/**
 * Validate the /api/connect/exchange response shape before trusting it. A 200
 * with an unexpected body must never store an empty/undefined key or render
 * "Signed in as undefined" — throw instead so the flow reports a clean failure.
 */
export function parseExchangeResponse(data: unknown): ExchangeResponse {
  if (!data || typeof data !== "object") {
    throw new Error("invalid_response_schema");
  }
  const d = data as Record<string, unknown>;
  if (
    typeof d.api_key !== "string" ||
    d.api_key.length === 0 ||
    typeof d.email !== "string" ||
    d.email.length === 0
  ) {
    throw new Error("invalid_response_schema");
  }
  normalizeApiKey(d.api_key); // also reject a wrong-prefix / bare-prefix key
  return data as ExchangeResponse;
}

// ---- onboarding policy (pure; vscode glue stays thin) ----------------------

/**
 * Error the MCP provider throws when it needs a key but none is stored. It
 * points at the keyless Sign In, NOT the manual paste command — the most common
 * first touch (a Copilot agent reaching for a memory tool) must route the user
 * into the keyless flow, not ask them to paste a key they do not have.
 */
export const SIGN_IN_REQUIRED_MESSAGE =
  'Not signed in to Mnemoverse. Run "Mnemoverse: Sign In" to connect your memory.';

/**
 * Whether to show the first-run welcome toast. Three conditions, all required:
 *
 *  - !hasKey                       — a user who already signed in / pasted a key
 *                                    never sees it.
 *  - !welcomeShownEver             — once ever (gated on a persisted flag).
 *  - !connectPromptShownThisSession — if the agent-touch path already raced ahead
 *                                    and toasted this session, skip the welcome so
 *                                    the user is not double-toasted; the persisted
 *                                    flag is then left UNSET (caller's job) so the
 *                                    welcome keeps its one-time turn for a later
 *                                    session.
 */
export function decideShowWelcome(
  hasKey: boolean,
  welcomeShownEver: boolean,
  connectPromptShownThisSession: boolean,
): boolean {
  return !hasKey && !welcomeShownEver && !connectPromptShownThisSession;
}
