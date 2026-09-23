import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ROOT, manifest } from "./helpers";

/**
 * package.json is part of the product: commands, settings, the walkthrough and
 * the chat skill are all declared there and point at files that must ship.
 * These checks catch a renamed file or a dropped entry before `vsce package`.
 */

const pkg = manifest();

describe("manifest", () => {
  it("keeps engines at ^1.102.0 (older hosts ignore the newer contribution points)", () => {
    expect(pkg.engines.vscode).toBe("^1.102.0");
  });

  it("declares the settings with the documented defaults", () => {
    const props = pkg.contributes.configuration.properties;
    expect(props["mnemoverse.connection"].enum).toEqual(["local", "hosted"]);
    expect(props["mnemoverse.connection"].default).toBe("local");
    expect(props["mnemoverse.showStatusBar"].default).toBe(true);
  });

  it("walkthrough: id, connect-step variants per host, and media files that exist", () => {
    const [wt] = pkg.contributes.walkthroughs;
    expect(wt.id).toBe("mnemoverse.getStarted");
    expect(wt.title).toBe("Get started with Mnemoverse Memory");
    const whens = wt.steps.map((s: { when?: string }) => s.when ?? "");
    expect(whens.some((w: string) => w.includes("mnemoverse.host == lm"))).toBe(true);
    expect(whens.some((w: string) => w.includes("mnemoverse.host == cursor"))).toBe(true);
    expect(whens.some((w: string) => w.includes("mnemoverse.host == guidance"))).toBe(true);
    const lmStep = wt.steps.find((s: { id: string }) => s.id === "connect.lm");
    expect(lmStep.completionEvents).toEqual(["onContext:mnemoverse.connected"]);
    for (const step of wt.steps) {
      expect(fs.existsSync(path.join(ROOT, step.media.markdown)), step.media.markdown).toBe(true);
    }
  });

  it("walkthrough command links point at declared commands", () => {
    const declared = new Set(pkg.contributes.commands.map((c: { command: string }) => c.command));
    for (const step of pkg.contributes.walkthroughs[0].steps) {
      for (const m of String(step.description).matchAll(/\(command:([\w.]+)\)/g)) {
        expect(declared.has(m[1]), m[1]).toBe(true);
      }
    }
  });

  it("chat skill: path points at SKILL.md whose name matches its folder", () => {
    const [skill] = pkg.contributes.chatSkills;
    const file = path.join(ROOT, skill.path);
    expect(path.basename(file)).toBe("SKILL.md");
    const text = fs.readFileSync(file, "utf8");
    const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    const name = /^name:\s*(.+)$/m.exec(front)?.[1].trim();
    const description = /^description:\s*"?(.+?)"?$/m.exec(front)?.[1] ?? "";
    expect(name).toBe(path.basename(path.dirname(file)));
    expect(name).toMatch(/^[a-z0-9-]{1,64}$/);
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it("user-facing text follows the team's wording rules", () => {
    const files = [
      "package.json",
      ...fs.readdirSync(path.join(ROOT, "media", "walkthrough")).map((f) => path.join("media", "walkthrough", f)),
      "skills/mnemoverse-memory/SKILL.md",
      ...fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => path.join("src", f)),
    ];
    const banned = [
      /memory_delete/,
      /\brevolutionary\b/i,
      /\bseamless(ly)?\b/i,
      /\bsupercharge/i,
      /\bunlock\b/i,
      /\b10x\b/i,
      /cutting-edge/i,
      /state-of-the-art/i,
      /AI-powered/i,
      /one key .*chatgpt/i,
      /same key .*chatgpt/i,
    ];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, f), "utf8");
      for (const re of banned) {
        expect(re.test(text), `${f} matches ${re}`).toBe(false);
      }
    }
  });
});
