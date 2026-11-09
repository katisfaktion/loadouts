import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, symlinkSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempEnv, run } from "./helpers";

function put(file: string, value: unknown) {
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}
function snapshot(dir: string): unknown {
  return Object.fromEntries(readdirSync(dir).sort().map(name => {
    const file = join(dir, name);
    return [name, lstatSync(file).isDirectory() ? snapshot(file) : readFileSync(file, "utf8")];
  }));
}
function fixture() {
  const t = tempEnv();
  mkdirSync(join(t.project, ".git"));
  return t;
}
function options(t: ReturnType<typeof tempEnv>) { return {cwd: t.project, env: {...t.env, PATH: ""}}; }

test("inspect preserves plugin scopes, source evidence and installed-only status before init", async () => {
  const t = fixture();
  put(join(t.home, ".claude/settings.json"), {enabledPlugins: {"review@tools": true}});
  put(join(t.home, ".claude/plugins/known_marketplaces.json"), {tools: {source: {source: "github", repo: "acme/user-tools"}}});
  put(join(t.project, ".claude/settings.json"), {enabledPlugins: {"review@tools": true}, extraKnownMarketplaces: {tools: {source: {source: "github", repo: "acme/project-tools"}}}});
  put(join(t.project, ".claude/settings.local.json"), {enabledPlugins: {"review@tools": false}});
  put(join(t.home, ".claude/plugins/installed_plugins.json"), {version: 2, plugins: {
    "available@tools": [{scope: "user", installPath: join(t.home, "plugin-cache")}],
    "here@tools": [{scope: "project", projectPath: t.project, installPath: join(t.home, "here-cache")}],
    "elsewhere@tools": [{scope: "project", projectPath: "/another-project", installPath: "/another-cache"}],
  }});
  put(join(t.home, ".codex/config.toml"), '[plugins."research@bundled"]\nenabled = true\n');
  const r = await run(["inspect", "--json"], options(t));
  expect(r.code).toBe(0);
  const report = JSON.parse(r.stdout);
  expect(report.initialized).toBe(false); expect(report.project).toBe(t.project);
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "review@tools", scope: "user", enabled: true, source: "acme/user-tools"}));
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "review@tools", scope: "project", enabled: true, source: "acme/project-tools"}));
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "review@tools", scope: "project-local", enabled: false, source: "acme/project-tools"}));
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "available@tools", enabled: null, installPath: join(t.home, "plugin-cache")}));
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "here@tools", scope: "project"}));
  expect(r.stdout).not.toContain("elsewhere@tools");
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "research@bundled", harness: "codex", enabled: true, source: null}));
});

test("inspect resolves installed skill sources without treating stale locks or guesses as installations", async () => {
  const t = fixture();
  put(join(t.project, ".agents/skills/runtime/SKILL.md"), "# runtime");
  mkdirSync(join(t.project, ".claude/skills"), {recursive: true});
  symlinkSync(join(t.project, ".agents/skills/runtime"), join(t.project, ".claude/skills/runtime"));
  put(join(t.project, "skills-lock.json"), {version: 1, skills: {runtime: {source: "acme/runtime", sourceType: "github", skillPath: "skills/runtime/SKILL.md"}, stale: {source: "acme/stale"}}});
  put(join(t.home, ".codex/skills/unknown/SKILL.md"), "# unknown");
  put(join(t.home, ".codex/skills/.system/system-tool/SKILL.md"), "# system-tool");
  put(join(t.home, ".agents/skills/global/SKILL.md"), "# global");
  put(join(t.home, ".agents/.skill-lock.json"), {version: 3, skills: {global: {source: "acme/global", sourceType: "github"}}});
  put(join(t.project, ".codex/skills/fallback/SKILL.md"), "# fallback");
  put(join(t.project, ".codex/skills/ambiguous/SKILL.md"), "# ambiguous");
  put(join(t.project, "loadouts.lock.json"), {version: 1, roots: {}, includes: {}, resolved: {}, harnesses: ["codex"], catalog: null, loadouts: {}, installed: {"skill:codex:acme/fallback@fallback": ["fallback"], "skill:codex:acme/one": ["ambiguous"], "skill:codex:acme/two": ["ambiguous"]}});
  const r = await run(["inspect", "--json"], options(t));
  expect(r.code).toBe(0);
  const {skills} = JSON.parse(r.stdout);
  expect(skills).toContainEqual(expect.objectContaining({name: "runtime", harness: "claude-code", source: "acme/runtime"}));
  expect(skills).toContainEqual(expect.objectContaining({name: "global", scope: "user", source: "acme/global"}));
  expect(skills).toContainEqual(expect.objectContaining({name: "system-tool", harness: "codex", source: null}));
  expect(skills).toContainEqual(expect.objectContaining({name: "fallback", source: "acme/fallback"}));
  expect(skills).toContainEqual(expect.objectContaining({name: "unknown", source: null}));
  expect(skills).toContainEqual(expect.objectContaining({name: "ambiguous", source: null}));
  expect(skills.some((s: any) => s.name === "stale")).toBe(false);
});

test("inspect omits MCP secrets and raw instruction/manifest contents in both output formats", async () => {
  const t = fixture(), secret = "PRIVATE_CREDENTIAL_SENTINEL";
  put(join(t.project, "package.json"), {name: secret, dependencies: {bun: "*"}});
  put(join(t.project, "AGENTS.md"), secret); put(join(t.home, ".claude/CLAUDE.md"), secret);
  put(join(t.home, ".claude.json"), {mcpServers: {userServer: {command: secret}}, projects: {[t.project]: {mcpServers: {localServer: {url: `https://host/${secret}`}}}, "/another-project": {mcpServers: {unrelated: {command: secret}}}}});
  put(join(t.project, ".mcp.json"), {mcpServers: {projectServer: {command: "runner", args: [secret], env: {TOKEN: secret}}}});
  put(join(t.project, ".codex/config.toml"), `[mcp_servers.remote]\nurl = "https://host/${secret}"\nhttp_headers = {Authorization = "${secret}"}\nenabled = false\n`);
  put(join(t.home, ".claude/settings.json"), {enabledPlugins: {"private@tools": true}, extraKnownMarketplaces: {tools: {source: {source: "git", url: `https://user:${secret}@github.com/acme/private`}}}});
  for (const args of [["inspect"], ["inspect", "--json"]]) {
    const r = await run(args, options(t));
    expect(r.code).toBe(0); expect(r.stdout + r.stderr).not.toContain(secret); expect(r.stdout).not.toContain("unrelated");
    if (args.length === 2) {
      const report = JSON.parse(r.stdout);
      expect(report.manifests).toEqual([join(t.project, "package.json")]);
      expect(report.instructions).toContain(join(t.home, ".claude/CLAUDE.md"));
      expect(report.mcp).toContainEqual(expect.objectContaining({name: "projectServer", transport: "stdio", scope: "project"}));
      expect(report.mcp).toContainEqual(expect.objectContaining({name: "localServer", transport: "http", scope: "project-local"}));
      expect(report.mcp).toContainEqual(expect.objectContaining({name: "remote", enabled: false, harness: "codex"}));
      expect(report.plugins[0].source).toBeNull();
    }
  }
});

test("inspect returns partial inventory and safe warnings for malformed metadata", async () => {
  const t = fixture();
  put(join(t.home, ".claude/settings.json"), '{"secret":"PRIVATE_PARSER_SENTINEL"');
  put(join(t.project, ".codex/config.toml"), 'token = "PRIVATE_TOML_SENTINEL');
  put(join(t.project, ".claude/settings.json"), {enabledPlugins: ["wrong shape"]});
  put(join(t.project, "skills-lock.json"), {skills: []});
  mkdirSync(join(t.project, ".mcp.json"));
  put(join(t.home, ".agents/skills/usable/SKILL.md"), "# usable");
  const r = await run(["inspect", "--json"], options(t));
  expect(r.code).toBe(1); expect(r.stdout).toContain("warnings");
  const report = JSON.parse(r.stdout);
  expect(report.skills).toContainEqual(expect.objectContaining({name: "usable"}));
  expect(report.warnings.length).toBeGreaterThanOrEqual(5);
  expect(report.warnings.join("\n")).toContain(join(t.home, ".claude/settings.json"));
  expect(r.stdout + r.stderr).not.toContain("PRIVATE_PARSER_SENTINEL");
  expect(r.stdout + r.stderr).not.toContain("PRIVATE_TOML_SENTINEL");
});

test("inspect locates the nearest project boundary including nested Git worktrees", async () => {
  const t = fixture();
  put(join(t.project, "loadouts.lock.json"), {installed: {}});
  const child = join(t.project, "child"), nested = join(child, "nested"), deep = join(nested, "src");
  mkdirSync(deep, {recursive: true});
  const parent = await run(["inspect", "--json"], {...options(t), cwd: child});
  expect(parent.code).toBe(0); expect(JSON.parse(parent.stdout).project).toBe(t.project);
  put(join(nested, ".git"), "gitdir: /unused/worktree");
  const r = await run(["inspect", "--json"], {...options(t), cwd: deep});
  expect(r.code).toBe(0); expect(JSON.parse(r.stdout).project).toBe(nested); expect(JSON.parse(r.stdout).initialized).toBe(false);
});

test("inspect is deterministic and does not invoke installers or modify state", async () => {
  const t = fixture();
  put(join(t.home, ".claude/settings.json"), {enabledPlugins: {"useful@tools": true}, extraKnownMarketplaces: {tools: {source: {source: "github", repo: "acme/tools"}}}});
  const before = {home: snapshot(t.home), project: snapshot(t.project)};
  const a = await run(["inspect", "--json"], options(t)), b = await run(["inspect", "--json"], options(t));
  expect(a.code).toBe(0); expect(b.stdout).toBe(a.stdout);
  const human = await run(["inspect"], options(t));
  expect(human.code).toBe(0); expect(human.stdout).toContain("user"); expect(human.stdout).toContain("acme/tools");
  expect(human.stdout).toContain(join(t.home, ".claude/settings.json"));
  expect({home: snapshot(t.home), project: snapshot(t.project)}).toEqual(before);
});

test("inspect rejects unexpected positional arguments", async () => {
  const r = await run(["inspect", "unexpected"]);
  expect(r.code).toBe(2); expect(r.stderr).toContain("loadouts help inspect");
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("inspect warns about inaccessible metadata parents and keeps readable inventory", async () => {
  const t = fixture(), plugins = join(t.home, ".claude/plugins"), agents = join(t.home, ".agents");
  put(join(plugins, "installed_plugins.json"), {version: 2, plugins: {"hidden@tools": [{scope: "user"}]}});
  put(join(agents, "skills/hidden/SKILL.md"), "# hidden");
  put(join(t.project, ".agents/skills/readable/SKILL.md"), "# readable");
  chmodSync(plugins, 0); chmodSync(agents, 0);
  try {
    const r = await run(["inspect", "--json"], options(t));
    expect(r.code).toBe(1);
    const report = JSON.parse(r.stdout);
    expect(report.warnings.join("\n")).toContain(join(plugins, "installed_plugins.json"));
    expect(report.warnings.join("\n")).toContain(join(agents, "skills"));
    expect(report.skills).toContainEqual(expect.objectContaining({name: "readable"}));
  } finally { chmodSync(plugins, 0o700); chmodSync(agents, 0o700); }
});

test("inspect skips ordinary files and file symlinks in skill directories", async () => {
  const t = fixture(), dir = join(t.project, ".agents/skills");
  put(join(dir, "README.md"), "Directory notes"); put(join(dir, "usable/SKILL.md"), "# usable");
  symlinkSync(join(dir, "README.md"), join(dir, "notes-link"));
  symlinkSync(join(dir, "usable"), join(dir, "usable-link"));
  const r = await run(["inspect", "--json"], options(t));
  expect(r.code).toBe(0);
  const report = JSON.parse(r.stdout);
  expect(report.warnings).toEqual([]);
  expect(report.skills.map((s: any) => s.name).sort()).toEqual(["usable", "usable-link"]);
});

test("inspect honors CODEX_HOME and excludes archived configuration and default-home evidence", async () => {
  const t = fixture(), custom = join(t.home, "custom-codex");
  put(join(custom, "config.toml"), '[plugins."active@tools"]\nenabled = true\n');
  put(join(custom, "skills/active/SKILL.md"), "active"); put(join(custom, "AGENTS.md"), "active instructions");
  put(join(t.home, ".codex/config.toml"), '[plugins."ignored@tools"]\nenabled = true\n');
  put(join(t.home, ".codex/AGENTS.md"), "ignored instructions");
  put(join(t.project, ".loadouts/codex-home/config.toml"), '[plugins."archived@tools"]\nenabled = true\n');
  const r = await run(["inspect", "--json"], {cwd: t.project, env: {...t.env, CODEX_HOME: custom}});
  expect(r.code).toBe(0); expect(r.stdout).not.toContain("ignored@tools"); expect(r.stdout).not.toContain("archived@tools");
  const report = JSON.parse(r.stdout);
  expect(report.plugins).toContainEqual(expect.objectContaining({id: "active@tools", scope: "user", path: join(custom, "config.toml")}));
  expect(report.skills).toContainEqual(expect.objectContaining({name: "active", scope: "user", path: join(custom, "skills/active/SKILL.md")}));
  expect(report.instructions).toContain(join(custom, "AGENTS.md")); expect(report.instructions).not.toContain(join(t.home, ".codex/AGENTS.md"));
});
