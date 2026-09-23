import { describe, it, expect } from "vitest";
import {
  HOSTED_MCP_URL,
  buildMcpConfigSnippet,
  detectHostKind,
  findMnemoverseServer,
  identifyHost,
  mcpConfigTargetFor,
  parseJsonc,
  type HostKind,
  type HostProbe,
} from "./hosts";

function probe(appName: string, uriScheme: string, hasLmProvider = true, hasCursorMcpApi = false): HostProbe {
  return { appName, uriScheme, hasLmProvider, hasCursorMcpApi };
}

describe("detectHostKind — host matrix", () => {
  const cases: Array<[string, HostProbe, HostKind]> = [
    // Hosts whose lm provider works → lm
    ["VS Code", probe("Visual Studio Code", "vscode"), "lm"],
    ["VS Code Insiders", probe("Visual Studio Code - Insiders", "vscode-insiders"), "lm"],
    ["VSCodium", probe("VSCodium", "vscodium"), "lm"],
    ["VSCodium Insiders", probe("VSCodium - Insiders", "vscodium-insiders"), "lm"],
    ["Positron", probe("Positron", "positron"), "lm"],
    ["Theia", probe("Theia", "theia"), "lm"],
    ["code-oss", probe("Code - OSS", "code-oss"), "lm"],
    ["unknown fork with a provider", probe("Some New IDE", "somenewide"), "lm"],
    // Cursor: its own API, never the stubbed provider
    ["Cursor with cursor.mcp", probe("Cursor", "cursor", true, true), "cursor"],
    ["Cursor without cursor.mcp (old build)", probe("Cursor", "cursor", true, false), "guidance"],
    ["unrecognised host exposing cursor.mcp", probe("Renamed Fork", "renamed", true, true), "cursor"],
    // Known to stub or ignore the provider → guidance even though lm exists
    ["Kiro", probe("Kiro", "kiro"), "guidance"],
    ["Windsurf", probe("Windsurf", "windsurf"), "guidance"],
    ["Devin Desktop", probe("Devin", "devin"), "guidance"],
    ["Trae", probe("Trae", "trae"), "guidance"],
    ["Antigravity", probe("Antigravity", "antigravity"), "guidance"],
    // No provider at all → guidance
    ["unknown fork without lm", probe("Some New IDE", "somenewide", false), "guidance"],
    ["VS Code without lm (should not happen, still safe)", probe("Visual Studio Code", "vscode", false), "guidance"],
  ];
  for (const [name, p, expected] of cases) {
    it(`${name} → ${expected}`, () => {
      expect(detectHostKind(p)).toBe(expected);
    });
  }

  it("a known no-op host never uses its provider, even if it also exposes cursor.mcp", () => {
    expect(detectHostKind(probe("Kiro", "kiro", true, true))).toBe("guidance");
  });
});

describe("identifyHost — matching rules", () => {
  it("matches app name and scheme case-insensitively", () => {
    expect(identifyHost({ appName: "CURSOR", uriScheme: "" })).toBe("cursor");
    expect(identifyHost({ appName: "", uriScheme: "Cursor" })).toBe("cursor");
    expect(identifyHost({ appName: "visual studio code", uriScheme: "" })).toBe("vscode");
  });

  it("matches by scheme alone when the app name is unfamiliar", () => {
    expect(identifyHost({ appName: "Something", uriScheme: "kiro" })).toBe("kiro");
    expect(identifyHost({ appName: "Something", uriScheme: "windsurf" })).toBe("windsurf");
  });

  it("checks no-op hosts before VS Code, so a fork mentioning VS Code is not mistaken for it", () => {
    expect(identifyHost({ appName: "Cursor (Visual Studio Code)", uriScheme: "vscode" })).toBe("cursor");
  });

  it("tells Insiders from stable", () => {
    expect(identifyHost({ appName: "Visual Studio Code - Insiders", uriScheme: "vscode-insiders" })).toBe("vscode-insiders");
    expect(identifyHost({ appName: "Visual Studio Code", uriScheme: "vscode" })).toBe("vscode");
  });

  it("does not match a word fragment ('Precursor' is not Cursor)", () => {
    expect(identifyHost({ appName: "Precursor", uriScheme: "precursor" })).toBe("unknown");
  });

  it("returns unknown for empty input", () => {
    expect(identifyHost({ appName: "", uriScheme: "" })).toBe("unknown");
  });
});

describe("buildMcpConfigSnippet — per host", () => {
  const parse = (s: string) => JSON.parse(s) as Record<string, Record<string, Record<string, string>>>;

  it("Kiro: mcpServers + url", () => {
    expect(parse(buildMcpConfigSnippet("kiro"))).toEqual({ mcpServers: { mnemoverse: { url: HOSTED_MCP_URL } } });
    expect(mcpConfigTargetFor("kiro").file).toBe("~/.kiro/settings/mcp.json");
  });

  it("Windsurf, Devin and Antigravity: mcpServers + serverUrl", () => {
    for (const host of ["windsurf", "devin", "antigravity"] as const) {
      expect(parse(buildMcpConfigSnippet(host))).toEqual({ mcpServers: { mnemoverse: { serverUrl: HOSTED_MCP_URL } } });
    }
    expect(mcpConfigTargetFor("windsurf").file).toContain("~/.codeium/windsurf/mcp_config.json");
    expect(mcpConfigTargetFor("antigravity").file).toContain("mcp_config.json");
  });

  it("Trae: mcpServers + url (unverified default)", () => {
    expect(parse(buildMcpConfigSnippet("trae"))).toEqual({ mcpServers: { mnemoverse: { url: HOSTED_MCP_URL } } });
  });

  it("Cursor: ~/.cursor/mcp.json with url", () => {
    expect(parse(buildMcpConfigSnippet("cursor"))).toEqual({ mcpServers: { mnemoverse: { url: HOSTED_MCP_URL } } });
    expect(mcpConfigTargetFor("cursor").file).toBe("~/.cursor/mcp.json");
  });

  it("VS Code family: VS Code's own mcp.json format (servers + type http)", () => {
    for (const host of ["vscode", "vscode-insiders", "vscodium", "positron", "code-oss"] as const) {
      expect(parse(buildMcpConfigSnippet(host))).toEqual({ servers: { mnemoverse: { type: "http", url: HOSTED_MCP_URL } } });
    }
  });

  it("unknown host: the common mcpServers + url default", () => {
    expect(parse(buildMcpConfigSnippet("unknown"))).toEqual({ mcpServers: { mnemoverse: { url: HOSTED_MCP_URL } } });
    expect(parse(buildMcpConfigSnippet("theia"))).toEqual({ mcpServers: { mnemoverse: { url: HOSTED_MCP_URL } } });
  });

  it("never contains a key", () => {
    for (const host of ["kiro", "windsurf", "cursor", "vscode", "unknown"] as const) {
      expect(buildMcpConfigSnippet(host)).not.toMatch(/mk_live|api[_-]?key|authorization/i);
    }
  });
});

describe("findMnemoverseServer — Cursor duplicate guard", () => {
  it("finds the hosted URL in a JSONC file with comments and trailing commas", () => {
    const text = `{
      // my servers
      "mcpServers": {
        /* the memory one */
        "memory": { "url": "https://mcp.mnemoverse.com/mcp", },
      },
    }`;
    expect(findMnemoverseServer(text)).toBe("memory");
  });

  it("finds the npm package in a stdio entry's args", () => {
    const text = JSON.stringify({
      mcpServers: {
        other: { command: "node", args: ["x.js"] },
        mnemo: { command: "npx", args: ["-y", "@mnemoverse/mcp-memory-server@latest"], env: {} },
      },
    });
    expect(findMnemoverseServer(text)).toBe("mnemo");
  });

  it("finds the npm package in the command itself", () => {
    const text = JSON.stringify({ mcpServers: { m: { command: "/usr/local/bin/@mnemoverse/mcp-memory-server" } } });
    expect(findMnemoverseServer(text)).toBe("m");
  });

  it("recognises serverUrl and VS Code's `servers` root too", () => {
    expect(findMnemoverseServer(JSON.stringify({ mcpServers: { a: { serverUrl: "https://MCP.MNEMOVERSE.COM/mcp" } } }))).toBe("a");
    expect(findMnemoverseServer(JSON.stringify({ servers: { b: { type: "http", url: "https://mcp.mnemoverse.com/mcp" } } }))).toBe("b");
  });

  it("returns undefined when no entry points at Mnemoverse", () => {
    expect(findMnemoverseServer(JSON.stringify({ mcpServers: { gh: { url: "https://api.githubcopilot.com/mcp" } } }))).toBeUndefined();
  });

  it("tolerates missing, empty and invalid files", () => {
    expect(findMnemoverseServer(undefined)).toBeUndefined();
    expect(findMnemoverseServer("")).toBeUndefined();
    expect(findMnemoverseServer("{ not json")).toBeUndefined();
    expect(findMnemoverseServer("[1,2,3]")).toBeUndefined();
    expect(findMnemoverseServer(JSON.stringify({ mcpServers: "nope" }))).toBeUndefined();
  });
});

describe("parseJsonc", () => {
  it("keeps `//` and `,}` inside string literals", () => {
    const v = parseJsonc('{ "a": "https://x.y/z", "b": "keep ,} this", // gone\n }') as Record<string, string>;
    expect(v).toEqual({ a: "https://x.y/z", b: "keep ,} this" });
  });

  it("handles escaped quotes inside strings", () => {
    expect(parseJsonc('{ "a": "say \\"hi\\" // not a comment" }')).toEqual({ a: 'say "hi" // not a comment' });
  });

  it("drops trailing commas in arrays", () => {
    expect(parseJsonc("[1, 2, ]")).toEqual([1, 2]);
  });
});
