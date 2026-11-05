import { test, expect } from "bun:test";
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { applyClaude } from "../src/claude";
import { codexConfigPath, prepareCodexConfig, expandProject, ensureGitignore } from "../src/codex";
import {writeIfChanged} from "../src/paths";
import { tempEnv, withEnv } from "./helpers";

function writeCodexHome(project: string, mcp: Record<string, any>): boolean {
  const artifacts = new Map(Object.entries(mcp).map(([name, value]) => [`mcp:codex:${name}`, {itemId: "test/server", mcp: value}]));
  return writeIfChanged(codexConfigPath(project), prepareCodexConfig(project, {version: 6, harnesses: ["codex"], catalog: null, loadouts: {}, installed: Object.fromEntries([...artifacts.keys()].map(k => [k, []])), resolved: {}}, artifacts));
}
test("Claude add, switch and removal preserve the user's own settings", () => {
  const {project} = tempEnv();
  mkdirSync(join(project, ".claude"));
  writeFileSync(join(project, ".claude/settings.json"), JSON.stringify({model: "opus", enabledPlugins: {"mine@x": true}}));
  writeFileSync(join(project, ".mcp.json"), JSON.stringify({other: 42, mcpServers: {own: {command: "mine"}}}));
  const add = new Map<string, any>([["plugin:superpowers@superpowers-dev", null], ["marketplace:superpowers-dev:obra/superpowers", null], ["mcp:claude-code:shadcn", {command: "bun", args: ["{project}"]}]]);
  expect(applyClaude(project, add, [])).toBe(true);
  expect(JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8")).mcpServers.shadcn.args).toEqual([project]);
  expect(applyClaude(project, add, [])).toBe(false);
  applyClaude(project, new Map([["plugin:replacement@x", null]]), [...add.keys()]);
  applyClaude(project, new Map(), ["plugin:replacement@x"]);
  expect(JSON.parse(readFileSync(join(project, ".claude/settings.json"), "utf8"))).toEqual({model: "opus", enabledPlugins: {"mine@x": true}, extraKnownMarketplaces: {}});
  expect(JSON.parse(readFileSync(join(project, ".mcp.json"), "utf8"))).toEqual({other: 42, mcpServers: {own: {command: "mine"}}});
});
test("project placeholders expand in every server field", () => {
  expect(expandProject({command: "{project}/bin", args: ["{project}"], env: {ROOT: "{project}"}, url: "http://x/{project}"}, "/tmp/p")).toEqual({command: "/tmp/p/bin", args: ["/tmp/p"], env: {ROOT: "/tmp/p"}, url: "http://x//tmp/p"});
});
test("Codex project config has valid TOML without authentication links or trust grants", async () => {
  const t = tempEnv();
  mkdirSync(join(t.home, ".codex")); writeFileSync(join(t.home, ".codex/auth.json"), "{}");
  await withEnv(t.env, () => {
    expect(writeCodexHome(t.project, {shadcn: {command: "npx", args: ["{project}"], env: {"KEY.WITH.DOTS": "value"}}})).toBe(true);
    const config = Bun.TOML.parse(readFileSync(codexConfigPath(t.project), "utf8")) as any;
    expect(config.mcp_servers.shadcn.command).toBe("npx");
    expect(config.projects).toBeUndefined();
    expect(existsSync(join(t.project, ".codex/auth.json"))).toBe(false);
    expect(existsSync(join(t.project, ".loadouts/codex-home"))).toBe(false);
    expect(writeCodexHome(t.project, {shadcn: {command: "npx", args: ["{project}"], env: {"KEY.WITH.DOTS": "value"}}})).toBe(false);
    expect(ensureGitignore(t.project)).toBe(true); expect(ensureGitignore(t.project)).toBe(false);
  });
});
test("invalid user settings are never overwritten", () => {
  const {project} = tempEnv(); mkdirSync(join(project, ".claude"));
  const file = join(project, ".claude/settings.json"); writeFileSync(file, "broken json");
  expect(() => applyClaude(project, new Map([["plugin:x@y", null]]), [])).toThrow();
  expect(readFileSync(file, "utf8")).toBe("broken json");
});
test("Codex regeneration preserves native plugin configuration and rejects damaged TOML", async () => {
  const t = tempEnv();
  await withEnv(t.env, () => {
    writeCodexHome(t.project, {});
    const file = codexConfigPath(t.project);
    writeFileSync(file, '[marketplaces.ponytail]\nsource_type = "git"\nsource = "https://github.com/DietrichGebert/ponytail.git"\n[plugins."ponytail@ponytail"]\nenabled = true\n[plugins."ponytail@ponytail".mcp_servers.docs]\nenabled_tools = ["search"]\n');
    const before = Bun.TOML.parse(readFileSync(file, "utf8")) as any;
    writeCodexHome(t.project, {docs: {command: "bun"}});
    const after = Bun.TOML.parse(readFileSync(file, "utf8")) as any;
    expect(after.plugins).toEqual(before.plugins); expect(after.marketplaces).toEqual(before.marketplaces);
    expect(after.mcp_servers.docs.command).toBe("bun");
    expect(writeCodexHome(t.project, {docs: {command: "bun"}})).toBe(false);
    writeFileSync(file, "broken = [");
    expect(() => writeCodexHome(t.project, {})).toThrow();
    expect(readFileSync(file, "utf8")).toBe("broken = [");
  });
});

test("Codex regeneration retains hook trust and disabled state", async () => {
  const t = tempEnv();
  await withEnv(t.env, () => {
    writeCodexHome(t.project, {});
    const file = codexConfigPath(t.project);
    writeFileSync(file, '[hooks.state."plugin:ponytail@ponytail:session-start"]\ntrusted_hash = "approved-content-hash"\nenabled = true\n[hooks.state."plugin:ponytail@ponytail:prompt"]\nenabled = false\n');
    const before = Bun.TOML.parse(readFileSync(file, "utf8")) as any;
    writeCodexHome(t.project, {});
    expect((Bun.TOML.parse(readFileSync(file, "utf8")) as any).hooks).toEqual(before.hooks);
    expect(writeCodexHome(t.project, {})).toBe(false);
  });
});

test("MCP preparation preserves pnpm commands and explicit npx options", async () => {
  const t = tempEnv();
  await withEnv(t.env, () => {
    const pnpm = {command: "pnpm", args: ["--silent", "dlx", "shadcn@latest", "mcp"]};
    expect(expandProject(pnpm, t.project)).toEqual(pnpm);
    const args = ["-y", "--prefix", "{project}/tools", "shadcn@latest", "mcp", "--prefix", "server-option"];
    for (const command of ["npx", "/tools/npx", "npx.cmd"]) expect(expandProject({command, args}, t.project)).toEqual({command, args: ["--prefix", ".loadouts", "-y", "--prefix", t.project + "/tools", "shadcn@latest", "mcp", "--prefix", "server-option"]});
  });
});

test("generated npx MCP configuration is portable between developer homes", async () => {
  const a = tempEnv(), b = tempEnv(), server = {command: "npx", args: ["shadcn@latest", "mcp"]};
  let first = "";
  for (const t of [a, b]) await withEnv(t.env, () => {
    applyClaude(t.project, new Map([["mcp:claude-code:ui", server]]), []);
    writeCodexHome(t.project, {ui: server});
    const text = readFileSync(join(t.project, ".mcp.json"), "utf8");
    expect(text).not.toContain(t.home); expect(text).not.toContain(t.env.LOADOUTS_CACHE!);
    expect(JSON.parse(text).mcpServers.ui.args).toEqual(["--prefix", ".loadouts", "shadcn@latest", "mcp"]);
    expect((Bun.TOML.parse(readFileSync(codexConfigPath(t.project), "utf8")) as any).mcp_servers.ui.args).toEqual(["--prefix", ".loadouts", "shadcn@latest", "mcp"]);
    if (first) expect(text).toBe(first); else first = text;
  });
});

 test("Codex config preparation protects symlink destinations", () => {
  const t = tempEnv(); symlinkSync(t.home, join(t.project, ".codex"));
  expect(() => writeCodexHome(t.project, {})).toThrow("symlink");
  expect(existsSync(join(t.home, "config.toml"))).toBe(false);
});

test("legacy plugin policy must be a table before migration", () => {
  const t = tempEnv(); mkdirSync(join(t.project, ".loadouts/codex-home"), {recursive: true});
  writeFileSync(join(t.project, ".loadouts/codex-home/config.toml"), '[plugins]\n"review@team" = "invalid"\n');
  const lock = {version: 3 as const, harnesses: ["codex" as const], catalog: null, resolved: {}, loadouts: {}, installed: {"codex-plugin:review@team": []}};
  expect(() => prepareCodexConfig(t.project, lock, new Map([["codex-plugin:review@team", {itemId: "test/review", mcp: null}]]))).toThrow("invalid plugins");
  expect(existsSync(codexConfigPath(t.project))).toBe(false);
});
