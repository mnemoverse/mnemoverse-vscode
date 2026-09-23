/**
 * Host detection and per-host MCP setup data — pure, VS Code-free (so it
 * unit-tests in node, like signin-core.ts).
 *
 * WHY THIS EXISTS. The extension is installed from two stores. The VS Code
 * Marketplace serves VS Code; Open VSX (about four times the downloads) serves
 * the forks: Cursor, Windsurf/Devin, Kiro, Trae, Antigravity, VSCodium,
 * Positron, Theia. Most forks inherit `vscode.lm.registerMcpServerDefinitionProvider`
 * from upstream, but several do NOT honour it:
 *
 *   - Cursor (checked in the 3.21.16 bundle) replaces it with a stub that logs
 *     "registerMcpServerDefinitionProvider is not supported in Cursor" and
 *     returns a no-op disposable. The call succeeds and nothing is registered.
 *     Cursor has its own `vscode.cursor.mcp.registerServer` instead.
 *   - Kiro exposes the function, calls provideMcpServerDefinitions, and never
 *     registers the result (kirodotdev/Kiro#2974, open).
 *   - Windsurf/Devin Desktop, Trae and Antigravity read MCP servers only from
 *     their own config files; none documents consuming extension-provided
 *     servers.
 *
 * So feature detection alone lies: `typeof lm.registerMcpServerDefinitionProvider
 * === "function"` is true in Cursor and Kiro. GitLens reached the same
 * conclusion (gitkraken/vscode-gitlens#4691) and whitelists by `env.appName`.
 * We do the inverse, which is kinder to forks we have never heard of: hosts
 * KNOWN to stub or ignore the provider never rely on it; every other host with
 * a callable provider (VS Code, Insiders, VSCodium, Positron, Theia, code-oss,
 * unknown forks) uses it.
 *
 * Nothing here touches the file system or the editor API: callers pass the
 * values in, which is what makes the host matrix testable without a fork
 * installed.
 */

/** The hosted MCP endpoint (OAuth, Streamable HTTP). Same 10 tools as the npm server. */
export const HOSTED_MCP_URL = "https://mcp.mnemoverse.com/mcp";

/** Host-neutral setup guide for editors that need a config-file entry. */
export const EDITORS_GUIDE_URL = "https://mnemoverse.com/docs/api/editors";

/**
 * Which way this extension wires memory into the running editor.
 *
 *   - `lm`       — VS Code's MCP provider API (stdio via npx + key, or the hosted URL).
 *   - `cursor`   — Cursor's own `vscode.cursor.mcp.registerServer` with the hosted URL.
 *   - `guidance` — no usable extension API: we only help the user add a config entry.
 */
export type HostKind = "lm" | "cursor" | "guidance";

/** Editor families we recognise. `unknown` is any other VS Code-compatible host. */
export type HostId =
  | "vscode"
  | "vscode-insiders"
  | "vscodium"
  | "positron"
  | "theia"
  | "code-oss"
  | "cursor"
  | "kiro"
  | "windsurf"
  | "devin"
  | "trae"
  | "antigravity"
  | "unknown";

/** What the caller observed about the running editor. */
export interface HostProbe {
  /** `vscode.env.appName`, e.g. "Visual Studio Code", "Cursor", "Kiro". */
  appName: string;
  /** `vscode.env.uriScheme`, e.g. "vscode", "cursor", "kiro". */
  uriScheme: string;
  /** `typeof vscode.lm?.registerMcpServerDefinitionProvider === "function"`. */
  hasLmProvider: boolean;
  /** `typeof vscode.cursor?.mcp?.registerServer === "function"`. */
  hasCursorMcpApi: boolean;
}

/**
 * Recognition rules, checked IN ORDER. The hosts that stub or ignore the
 * provider come first so that a fork whose appName also mentions VS Code
 * (e.g. "Cursor — built on Visual Studio Code") is never mistaken for VS Code.
 *
 * Each rule matches the URI scheme exactly OR the app name by a word-bounded,
 * case-insensitive pattern. Scheme values come from each product's
 * `product.json` `urlProtocol` where it could be checked (Cursor "cursor",
 * VSCodium "vscodium"/"vscodium-insiders", Positron "positron", Theia "theia");
 * the Devin, Trae and Antigravity schemes are best guesses, which is why the
 * app-name pattern is there as a second key.
 */
const HOST_RULES: ReadonlyArray<{ id: HostId; schemes: readonly string[]; appName: RegExp }> = [
  { id: "cursor", schemes: ["cursor"], appName: /\bcursor\b/i },
  { id: "kiro", schemes: ["kiro"], appName: /\bkiro\b/i },
  { id: "windsurf", schemes: ["windsurf", "windsurf-next"], appName: /\bwindsurf\b/i },
  // Windsurf was renamed Devin Desktop on 2026-06-02 (appName "Devin").
  { id: "devin", schemes: ["devin", "devin-desktop"], appName: /^devin\b/i },
  { id: "trae", schemes: ["trae", "trae-cn"], appName: /\btrae\b/i },
  { id: "antigravity", schemes: ["antigravity"], appName: /\bantigravity\b/i },
  { id: "vscode-insiders", schemes: ["vscode-insiders"], appName: /^visual studio code - insiders$/i },
  { id: "vscode", schemes: ["vscode"], appName: /^visual studio code\b/i },
  { id: "vscodium", schemes: ["vscodium", "vscodium-insiders"], appName: /\bvscodium\b/i },
  { id: "positron", schemes: ["positron"], appName: /\bpositron\b/i },
  { id: "theia", schemes: ["theia"], appName: /\btheia\b/i },
  { id: "code-oss", schemes: ["code-oss"], appName: /^code - oss\b/i },
];

/**
 * Hosts known to expose `registerMcpServerDefinitionProvider` without acting on
 * it, or to read MCP servers only from their own config file. The provider is
 * never trusted here, even when the function exists.
 */
const NO_EXTENSION_MCP_HOSTS: ReadonlySet<HostId> = new Set<HostId>([
  "cursor",
  "kiro",
  "windsurf",
  "devin",
  "trae",
  "antigravity",
]);

/** Identify the editor family from its app name and URI scheme (case-insensitive). */
export function identifyHost(probe: Pick<HostProbe, "appName" | "uriScheme">): HostId {
  const scheme = (probe.uriScheme ?? "").trim().toLowerCase();
  const app = (probe.appName ?? "").trim();
  for (const rule of HOST_RULES) {
    if (rule.schemes.includes(scheme) || rule.appName.test(app)) {
      return rule.id;
    }
  }
  return "unknown";
}

/**
 * Pick the adapter for this editor.
 *
 *   1. Cursor with `vscode.cursor.mcp.registerServer` → `cursor`. An
 *      unrecognised host that nevertheless exposes that Cursor-only namespace
 *      is treated as Cursor too: only Cursor builds ship it, and Cursor also
 *      stubs the lm provider, so trusting lm there would register nothing.
 *   2. A host known to stub or ignore the provider → `guidance`.
 *   3. Any other host with a callable provider → `lm`.
 *   4. No provider at all → `guidance`.
 */
export function detectHostKind(probe: HostProbe): HostKind {
  const id = identifyHost(probe);
  if (probe.hasCursorMcpApi && (id === "cursor" || id === "unknown")) {
    return "cursor";
  }
  if (NO_EXTENSION_MCP_HOSTS.has(id)) {
    return "guidance";
  }
  return probe.hasLmProvider ? "lm" : "guidance";
}

// ---- config snippets for editors we cannot register into ------------------

/**
 * Where a host reads MCP servers from, and the JSON shape it expects for a
 * remote (URL) server. Data-driven so a corrected path is a one-line change.
 *
 * `file` is shown to the user verbatim ("paste it into <file>"); `~` is the
 * home folder (%USERPROFILE% on Windows).
 */
export interface McpConfigTarget {
  /** Where to paste the snippet, as shown to the user. */
  file: string;
  /** Top-level object that holds the servers. */
  rootKey: "mcpServers" | "servers";
  /** Field that carries the remote URL. */
  urlField: "url" | "serverUrl";
  /** Extra fixed fields for the server entry (e.g. VS Code's `type: "http"`). */
  extra?: Readonly<Record<string, string>>;
  /**
   * The same file(s) as paths relative to the home folder ("/"-separated), for
   * a READ-ONLY check that the user already added Mnemoverse. Set only where
   * the location is documented; without it the extension cannot tell whether
   * the user finished the setup, and its state text says so instead of
   * claiming "set up needed" forever.
   */
  homePaths?: readonly string[];
  /**
   * Whether auth.mnemoverse.com accepts this editor's own MCP sign-in (its
   * OAuth redirect must be on the auth service's dynamic-registration
   * allowlist: loopback, vscode.dev, cursor://anysphere.cursor-mcp/, ...).
   *
   *   - `accepted`     — checked against the allowlist.
   *   - `unverified`   — the editor's redirect is not known; the text hedges.
   *   - `not-accepted` — known to be refused today; the text says so rather
   *                      than promising a browser sign-in that will fail.
   */
  signIn: "accepted" | "unverified" | "not-accepted";
  /** A step after saving the file, for editors that do not pick up edits by themselves. */
  afterSave?: string;
}

/**
 * VS Code's own mcp.json format, shared by the upstream-based hosts. VS Code's
 * MCP OAuth redirects to a loopback address (desktop) or vscode.dev (web), both
 * on the auth allowlist. No `homePaths`: the user mcp.json lives in a
 * per-product, per-profile folder the extension does not try to guess.
 */
const VSCODE_MCP_JSON: McpConfigTarget = {
  file: 'your user mcp.json (Command Palette: "MCP: Open User Configuration")',
  rootKey: "servers",
  urlField: "url",
  extra: { type: "http" },
  signIn: "accepted",
};

/** The common `mcpServers` + `url` shape most MCP clients accept. */
const DEFAULT_TARGET: McpConfigTarget = {
  file: "your editor's MCP config file",
  rootKey: "mcpServers",
  urlField: "url",
  signIn: "unverified",
};

const MCP_CONFIG_TARGETS: Readonly<Partial<Record<HostId, McpConfigTarget>>> = {
  vscode: VSCODE_MCP_JSON,
  "vscode-insiders": VSCODE_MCP_JSON,
  vscodium: VSCODE_MCP_JSON,
  "code-oss": VSCODE_MCP_JSON,
  positron: VSCODE_MCP_JSON,
  // Cursor's documented global file. Used only if the Cursor adapter could not
  // register (the adapter itself never writes this file). Cursor's MCP OAuth
  // callback, cursor://anysphere.cursor-mcp/, is on the auth allowlist.
  cursor: {
    file: "~/.cursor/mcp.json",
    rootKey: "mcpServers",
    urlField: "url",
    homePaths: [".cursor/mcp.json"],
    signIn: "accepted",
  },
  // kiro.dev/docs/mcp/configuration: user file, remote `url`, hot-reloaded,
  // OAuth via dynamic client registration with a loopback redirect (allowed).
  kiro: {
    file: "~/.kiro/settings/mcp.json",
    rootKey: "mcpServers",
    urlField: "url",
    homePaths: [".kiro/settings/mcp.json"],
    signIn: "accepted",
  },
  // Windsurf's Cascade reads `serverUrl` for remote servers. Its OAuth
  // redirect is not documented, so the sign-in promise is hedged.
  windsurf: {
    file: "~/.codeium/windsurf/mcp_config.json",
    rootKey: "mcpServers",
    urlField: "serverUrl",
    homePaths: [".codeium/windsurf/mcp_config.json"],
    signIn: "unverified",
  },
  // Devin Desktop (ex-Windsurf) is mid-migration: the FAQ still names the
  // Windsurf file, while Devin Local reads the Devin CLI config. Both paths are
  // shown and checked; the `serverUrl` field follows Windsurf and is NOT
  // verified for the Devin CLI file.
  devin: {
    file: "~/.codeium/windsurf/mcp_config.json (or ~/.config/devin/mcp_config.json for Devin Local)",
    rootKey: "mcpServers",
    urlField: "serverUrl",
    homePaths: [".codeium/windsurf/mcp_config.json", ".config/devin/mcp_config.json"],
    signIn: "unverified",
  },
  // antigravity.google/docs/mcp: global file ~/.gemini/config/mcp_config.json,
  // remote servers need `serverUrl` ("url" is not supported), and the IDE's MCP
  // list has a Refresh button. Its OAuth redirect
  // (https://antigravity.google/oauth-callback) is NOT on auth.mnemoverse.com's
  // dynamic-registration allowlist (REGISTRATION_ALLOWED_REDIRECT_HOSTS in the
  // auth service), so the sign-in is refused until the owner admits it. Flip
  // `signIn` to "accepted" in the same change that allowlists it.
  antigravity: {
    file: "~/.gemini/config/mcp_config.json",
    rootKey: "mcpServers",
    urlField: "serverUrl",
    homePaths: [".gemini/config/mcp_config.json"],
    signIn: "not-accepted",
    afterSave: "click Refresh in Antigravity's MCP server list (or restart Antigravity)",
  },
  // UNVERIFIED: Trae's file location and field name come from third-party
  // reports (macOS: ~/Library/Application Support/Trae/User/mcp.json), not from
  // Trae's docs or a real install. `url` is the common default. No `homePaths`.
  trae: { file: "Trae's mcp.json (in Trae's MCP settings)", rootKey: "mcpServers", urlField: "url", signIn: "unverified" },
};

/** The config target for a host, falling back to the common `mcpServers`/`url` shape. */
export function mcpConfigTargetFor(host: HostId): McpConfigTarget {
  return MCP_CONFIG_TARGETS[host] ?? DEFAULT_TARGET;
}

/**
 * The JSON to paste for the hosted OAuth server. It never contains a key: the
 * host signs the user in itself (OAuth with dynamic client registration), so a
 * copied snippet leaks nothing if it ends up in a repo or a chat.
 */
export function buildMcpConfigSnippet(host: HostId): string {
  const t = mcpConfigTargetFor(host);
  const entry: Record<string, string> = { ...(t.extra ?? {}), [t.urlField]: HOSTED_MCP_URL };
  return JSON.stringify({ [t.rootKey]: { mnemoverse: entry } }, null, 2);
}

// ---- browser sign-in (the extension's own keyless flow) ---------------------

/**
 * URI schemes the console's keyless sign-in accepts as a redirect back into the
 * editor. MIRRORS `ALLOWED_EDITOR_SCHEMES` in mnemoverse-portal
 * src/lib/extension-auth.ts — the portal is the authority; this copy only
 * decides whether to OFFER the browser flow.
 *
 * Why the extension needs to know: on an lm host whose scheme is not listed
 * (Positron "positron", Theia "theia", VSCodium Insiders "vscodium-insiders",
 * unknown forks) the consent page refuses the request as "not from a supported
 * editor", while the editor sits on a "Finishing sign-in…" notification for the
 * full 30-minute wait. Those hosts are offered a pasted key instead. When the
 * portal adds a scheme (an owner decision), add it here too.
 */
export const BROWSER_SIGNIN_SCHEMES: ReadonlySet<string> = new Set([
  "vscode",
  "vscode-insiders",
  "cursor",
  "vscodium",
  "code-oss",
  "windsurf",
]);

/** Whether the console's browser sign-in can return to an editor with this URI scheme. */
export function canBrowserSignIn(uriScheme: string | undefined): boolean {
  return BROWSER_SIGNIN_SCHEMES.has((uriScheme ?? "").trim().toLowerCase());
}

// ---- duplicate guard: is Mnemoverse already in a user's MCP config? ---------

/** The hosted endpoint's host. Compared exactly, never as a substring. */
const HOSTED_HOST = new URL(HOSTED_MCP_URL).hostname;

/**
 * The npm package as a launcher argument: the bare name or name@version/tag.
 * Anchored: `@mnemoverse/mcp-memory-server-typo` or a path that merely contains
 * the name does not match.
 */
const PACKAGE_SPEC = /^@mnemoverse\/mcp-memory-server(@[\w.^~-]+)?$/i;

/**
 * Package-runner flags that may precede the package without changing WHAT runs.
 * Anything else (`--registry=…`, `-p other-pkg`, `--call`, …) could fetch or run
 * something other than Mnemoverse's package, so the entry is not trusted.
 */
const HARMLESS_RUNNER_FLAGS: ReadonlySet<string> = new Set(["-y", "--yes", "-q", "--quiet", "--silent"]);

/**
 * Environment variables that redirect what npx installs or runs (a different
 * registry, preloaded code). An entry that sets one is not counted as ours.
 */
const RUNNER_OVERRIDE_ENV = /^(npm_config_|node_options$|node_path$)/i;

/**
 * Return the name of an existing Mnemoverse server entry in an mcp.json-style
 * file, or `undefined` if there is none (or the text is not readable JSON).
 *
 * WHY. Cursor would otherwise show every tool twice when the user already added
 * Mnemoverse by hand (docs, the Cursor plugin's snippet, `.cursor/mcp.json` in a
 * repo) and the extension registers it again; on config-file editors it tells
 * the extension the user finished the setup. The file is user-edited, so the
 * parse tolerates JSONC: `//` and block comments and trailing commas — the
 * exact things a hand-edited file picks up. Anything still unparseable counts
 * as "no entry": a broken file must never block registration.
 *
 * EXACT MATCHING (security). Some of these files come from a cloned repository
 * (`<workspace>/.cursor/mcp.json`). A match makes the extension skip its own
 * registration and show the entry as the user's Mnemoverse setup, so a
 * lookalike must never match: `https://mcp.mnemoverse.com.evil.example`,
 * `https://evil.example/?ref=mcp.mnemoverse.com`, `@mnemoverse/mcp-memory-server-typo`
 * and `bash -c "curl … # @mnemoverse/mcp-memory-server"` are all rejected.
 * Accepted: an https URL whose host IS mcp.mnemoverse.com, or a standard
 * package runner whose first positional argument IS the package (see
 * `runsMnemoversePackage`). Entries with `"disabled": true` are skipped — the
 * editor does not run them.
 */
export function findMnemoverseServer(configText: string | undefined): string | undefined {
  const parsed = parseJsonc(configText);
  if (!isRecord(parsed)) {
    return undefined;
  }
  // Cursor and most forks use `mcpServers`; accept VS Code's `servers` too so a
  // copied VS Code snippet is recognised.
  for (const rootKey of ["mcpServers", "servers"]) {
    const servers = parsed[rootKey];
    if (!isRecord(servers)) {
      continue;
    }
    for (const [name, entry] of Object.entries(servers)) {
      if (isRecord(entry) && entry.disabled !== true && entryPointsAtMnemoverse(entry)) {
        return name;
      }
    }
  }
  return undefined;
}

function entryPointsAtMnemoverse(entry: Record<string, unknown>): boolean {
  for (const field of ["url", "serverUrl"]) {
    if (isHostedUrl(entry[field])) {
      return true;
    }
  }
  if (isRecord(entry.env) && Object.keys(entry.env).some((k) => RUNNER_OVERRIDE_ENV.test(k))) {
    return false;
  }
  return runsMnemoversePackage(entry.command, entry.args);
}

/** An https URL whose host is exactly the hosted endpoint's host. */
function isHostedUrl(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" && u.hostname.toLowerCase() === HOSTED_HOST && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

/** "npx", "npx.cmd", "/usr/local/bin/npx", "C:\\…\\npx.CMD" → "npx". */
function executableName(command: string): string {
  const base = command.trim().split(/[\\/]/).pop() ?? "";
  return base.toLowerCase().replace(/\.(cmd|exe|bat)$/, "");
}

/**
 * Whether `command` + `args` run Mnemoverse's npm package through a standard
 * package runner, with nothing else in the way:
 *
 *   npx | pnpx | bunx  [harmless flags] @mnemoverse/mcp-memory-server[@ver] …
 *   pnpm dlx | yarn dlx | bun x  (same)
 *   cmd /c <one of the above>   (the usual Windows form)
 *
 * The package must be the FIRST positional argument: in `npx -y evil-pkg
 * @mnemoverse/mcp-memory-server` npx runs evil-pkg, so that does not count.
 * Free-form strings (a shell command line) are never scanned.
 */
function runsMnemoversePackage(command: unknown, args: unknown): boolean {
  if (typeof command !== "string" || !Array.isArray(args) || !args.every((a) => typeof a === "string")) {
    return false;
  }
  let rest = args as string[];
  let runner = executableName(command);
  if (runner === "cmd") {
    if ((rest[0] ?? "").toLowerCase() !== "/c") {
      return false;
    }
    runner = executableName(rest[1] ?? "");
    rest = rest.slice(2);
  }
  switch (runner) {
    case "npx":
    case "pnpx":
    case "bunx":
      break;
    case "pnpm":
    case "yarn":
      if (rest[0] !== "dlx") return false;
      rest = rest.slice(1);
      break;
    case "bun":
      if (rest[0] !== "x") return false;
      rest = rest.slice(1);
      break;
    default:
      return false;
  }
  for (const arg of rest) {
    if (arg.startsWith("-")) {
      if (!HARMLESS_RUNNER_FLAGS.has(arg)) {
        return false;
      }
      continue;
    }
    return PACKAGE_SPEC.test(arg);
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse JSON that may contain comments and trailing commas. Returns
 * `undefined` for empty or unparseable input instead of throwing.
 *
 * A regex strip would corrupt URLs (`https://…` contains `//`), so this walks
 * the text once and copies string literals through untouched.
 */
export function parseJsonc(text: string | undefined): unknown {
  if (!text || !text.trim()) {
    return undefined;
  }
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      // Copy a string literal verbatim, honouring backslash escapes.
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        j += text[j] === "\\" ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  // Trailing commas get a second string-aware pass: a `,}` inside a string
  // literal is data and must survive.
  out = stripTrailingCommas(out);
  try {
    return JSON.parse(out);
  } catch {
    return undefined;
  }
}

/** Remove `,` that is followed only by whitespace and then `}` or `]`, outside strings. */
function stripTrailingCommas(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        j += text[j] === "\\" ? 2 : 1;
      }
      out += text.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ",") {
      let k = i + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] === "}" || text[k] === "]") {
        i++; // skip the trailing comma
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}
