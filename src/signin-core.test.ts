import { describe, it, expect } from "vitest";
import { webcrypto as wc } from "node:crypto";
import {
  base64urlEncode,
  generateState,
  generatePkce,
  deriveConfirmCode,
  buildRedirectUri,
  buildConnectUrl,
  parseCallback,
  normalizeApiKey,
  parseExchangeResponse,
} from "./signin-core";

describe("base64urlEncode", () => {
  it("is unpadded and URL-safe", () => {
    expect(base64urlEncode(new Uint8Array([255, 255, 255, 255]))).not.toMatch(/[+/=]/);
  });
});

describe("generateState", () => {
  it("is a 43-char unpadded base64url string (256-bit), unique per call", () => {
    const a = generateState();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateState()).not.toBe(a);
  });
});

describe("generatePkce", () => {
  it("verifier is 43-char base64url; challenge = base64url(SHA256(verifier))", async () => {
    const { verifier, challenge } = await generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const d = new Uint8Array(await wc.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(challenge).toBe(base64urlEncode(d));
  });
});

describe("deriveConfirmCode — MUST match the portal golden vector", () => {
  it("'golden-vector-state' → 5V9K-DASW (cross-side contract with portal connect-page.ts)", async () => {
    expect(await deriveConfirmCode("golden-vector-state")).toBe("5V9K-DASW");
  });
  it("is deterministic, formatted XXXX-XXXX, safe alphabet", async () => {
    expect(await deriveConfirmCode("x")).toBe(await deriveConfirmCode("x"));
    expect(await deriveConfirmCode("x")).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe("buildRedirectUri — lowercase authority (VS Code lowercases it)", () => {
  it("builds <scheme>://mnemoverse.mnemoverse-vscode/auth-callback", () => {
    expect(buildRedirectUri("vscode")).toBe("vscode://mnemoverse.mnemoverse-vscode/auth-callback");
    expect(buildRedirectUri("cursor")).toBe("cursor://mnemoverse.mnemoverse-vscode/auth-callback");
  });
});

describe("buildConnectUrl", () => {
  it("targets the console connect page with all params encoded", () => {
    const url = buildConnectUrl({
      state: "st 1",
      redirectUri: "vscode://mnemoverse.mnemoverse-vscode/auth-callback",
      codeChallenge: "C".repeat(43),
      name: "VS Code — host",
      editor: "vscode",
    });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://console.mnemoverse.com/connect/vscode");
    expect(u.searchParams.get("state")).toBe("st 1");
    expect(u.searchParams.get("redirect_uri")).toBe("vscode://mnemoverse.mnemoverse-vscode/auth-callback");
    expect(u.searchParams.get("code_challenge")).toBe("C".repeat(43));
    expect(u.searchParams.get("name")).toBe("VS Code — host");
    expect(u.searchParams.get("editor")).toBe("vscode");
  });
});

describe("parseCallback", () => {
  it("extracts code + state on success", () => {
    expect(parseCallback("code=abc&state=st1")).toEqual({ kind: "code", code: "abc", state: "st1" });
  });
  it("extracts error + state on cancel", () => {
    expect(parseCallback("error=access_denied&state=st1")).toEqual({ kind: "error", error: "access_denied", state: "st1" });
  });
  it("returns invalid when neither code nor error present", () => {
    expect(parseCallback("foo=bar").kind).toBe("invalid");
    expect(parseCallback("").kind).toBe("invalid");
  });
});

describe("normalizeApiKey — only persist a well-formed mk_live_ key", () => {
  it("trims and returns a valid key", () => {
    expect(normalizeApiKey("  mk_live_abc123  ")).toBe("mk_live_abc123");
  });
  it("throws on empty / wrong prefix", () => {
    expect(() => normalizeApiKey("")).toThrow(/invalid_key_format/);
    expect(() => normalizeApiKey("   ")).toThrow(/invalid_key_format/);
    expect(() => normalizeApiKey("sk_live_x")).toThrow(/invalid_key_format/);
    expect(() => normalizeApiKey("undefined")).toThrow(/invalid_key_format/);
  });
});

describe("parseExchangeResponse — validate the server shape before trusting it", () => {
  const good = { api_key: "mk_live_x", key_prefix: "mk_live_x", organization_id: "user_a", tier: "free", email: "a@x.io", contract_version: 1 };
  it("accepts a well-formed response", () => {
    expect(parseExchangeResponse(good)).toEqual(good);
  });
  it("rejects a non-object / null", () => {
    expect(() => parseExchangeResponse(null)).toThrow(/invalid_response_schema/);
    expect(() => parseExchangeResponse("nope")).toThrow(/invalid_response_schema/);
  });
  it("rejects a missing / non-string api_key", () => {
    expect(() => parseExchangeResponse({ ...good, api_key: undefined })).toThrow(/invalid_response_schema/);
    expect(() => parseExchangeResponse({ ...good, api_key: 123 })).toThrow(/invalid_response_schema/);
  });
  it("rejects a malformed api_key (wrong prefix)", () => {
    expect(() => parseExchangeResponse({ ...good, api_key: "sk_x" })).toThrow();
  });
  it("rejects a missing / non-string email", () => {
    expect(() => parseExchangeResponse({ ...good, email: undefined })).toThrow(/invalid_response_schema/);
  });
});
