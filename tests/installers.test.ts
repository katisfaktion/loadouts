import { test, expect } from "bun:test";
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, unlinkSync, symlinkSync, statSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, run, repo } from "./helpers";
import { readLock } from "../src/lock";

function fixture() {
  const t = tempEnv(), bin = join(t.home, "bin"), log = join(t.home, "installer.log");
  mkdirSync(bin); const executable = join(bin, "codebase-memory-mcp");
  const control = join(t.home, "control.json");
  writeFileSync(executable, `#!/bin/sh\nexport FAKE_INSTALLER_LOG='${log}'\nexport FAKE_INSTALLER_CONTROL='${control}'\nexec '${process.execPath}' '${join(repo, "tests/fixtures/fake-installer.ts")}' "$@"\n`); chmodSync(executable, 0o755);
  mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  writeFileSync(join(t.project, ".loadouts/catalog/memory.yml"), "name: memory\nitems: {graph: {installer: codebase-memory}}\nrouting: [{when: Exploring, use: [graph]}]\n");
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: ["claude-code", "codex"], loadouts: {memory: {source: "file:./.loadouts/catalog/memory.yml"}}}));
  const env = {...t.env, PATH: bin + ":" + process.env.PATH, FAKE_INSTALLER_LOG: log};
  return {...t, env, bin, log, executable, run: (args: string[], extra = {}) => { writeFileSync(control, JSON.stringify(extra)); return run(args, {cwd: t.project, env: {...env, ...extra}}); }};
}
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const calls = (file: string) => readFileSync(file, "utf8").trim().split("\n").map(l => JSON.parse(l));

test("adopts an existing global CLI, imports native assets and indexes once across repeated installs", async () => {
  const t = fixture();
  mkdirSync(join(t.home, ".claude")); writeFileSync(join(t.home, ".claude/settings.json"), '{"personal":true}');
  const binaryTime = statSync(t.executable).mtimeMs;
  expect(await t.run(["install"])).toMatchObject({code: 0});
  const lock = readLock(t.project);
  expect(lock.installers).toEqual({"codebase-memory": {version: "0.12.1"}});
  expect(lock.installed["installer:codex:codebase-memory"]).toEqual([]);
  expect(json(join(t.project, ".mcp.json")).mcpServers["codebase-memory-mcp"].command).toBe("codebase-memory-mcp");
  const config = join(t.project, ".codex/config.toml"), agent = join(t.project, ".codex/agents/codebase-memory.toml");
  expect((Bun.TOML.parse(readFileSync(config, "utf8")) as any).mcp_servers["codebase-memory-mcp"].command).toBe("codebase-memory-mcp");
  expect(existsSync(agent)).toBe(true);
  expect(existsSync(join(t.project, ".agents/skills/codebase-memory/SKILL.md"))).toBe(true);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("Use codebase-memory before structural searches.");
  const settings = join(t.project, ".claude/settings.local.json");
  expect(json(settings).hooks.SessionStart).toHaveLength(1);
  const before = [config, agent, settings, join(t.project, "loadouts.lock.json")].map(f => [f, readFileSync(f, "utf8"), statSync(f).mtimeMs]);
  expect(await t.run(["install"])).toMatchObject({code: 0, stdout: "Nothing changed.\n"});
  for (const [file, content, time] of before) { expect(readFileSync(file as string, "utf8")).toBe(content); expect(statSync(file as string).mtimeMs).toBe(time); }
  expect(calls(t.log).filter(c => c.args[0] === "install")).toHaveLength(1);
  expect(calls(t.log).filter(c => c.args[0] === "cli")).toHaveLength(1);
  expect(calls(t.log).find(c => c.args[0] === "cli").args).toEqual(["cli", "index_repository", "--repo-path", t.project]);
  expect(calls(t.log).find(c => c.args[0] === "install").home).not.toBe(t.home);
  expect(readFileSync(join(t.home, ".claude/settings.json"), "utf8")).toBe('{"personal":true}');
  expect(statSync(t.executable).mtimeMs).toBe(binaryTime);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("MCP server `codebase-memory-mcp`");
});

test("generated agent MCP commands work when the installed executable is a symlink to a renamed binary", async () => {
  const t = fixture(), target = join(t.home, "cbm-0.12.1");
  renameSync(t.executable, target); symlinkSync(target, t.executable);
  expect((await t.run(["install"])).code).toBe(0);
  for (const name of ["codebase-memory", "codebase-memory-scout", "codebase-memory-auditor"]) {
    const profile = Bun.TOML.parse(readFileSync(join(t.project, `.codex/agents/${name}.toml`), "utf8")) as any;
    const binary = profile.mcp_servers["codebase-memory-mcp"].command;
    expect(binary).toBe("codebase-memory-mcp");
  }
});

test("repairs missing profiles and preserves unrelated hooks on removal", async () => {
  const t = fixture(); const settings = join(t.project, ".claude/settings.local.json");
  mkdirSync(join(t.project, ".claude"));
  const own = {hooks: [{type: "command", command: "echo personal"}]};
  writeFileSync(settings, JSON.stringify({model: "personal", hooks: {SessionStart: [own]}}));
  expect((await t.run(["install"])).code).toBe(0);
  const profile = join(t.project, ".claude/agents/codebase-memory.md"); unlinkSync(profile);
  expect(readLock(t.project).installed).toHaveProperty("installer:claude-code:codebase-memory");
  expect((await t.run(["status", "--json"])).stdout).toContain('"needsInstall": true');
  const repaired = await t.run(["install"]);
  expect(repaired.code).toBe(0); expect(repaired.stdout).not.toContain("Nothing changed."); expect(existsSync(profile)).toBe(true);
  expect(calls(t.log).filter(c => c.args[0] === "cli")).toHaveLength(1);
  expect((await t.run(["remove", "memory"])).code).toBe(0);
  expect(existsSync(profile)).toBe(false);
  expect(json(settings)).toEqual({model: "personal", hooks: {SessionStart: [own]}});
  expect(json(join(t.project, ".mcp.json")).mcpServers).toEqual({});
  expect(existsSync(t.executable)).toBe(true);
  expect(calls(t.log).some(c => ["uninstall", "update"].includes(c.args[0]))).toBe(false);
});

test("finishes an interrupted asset refresh after an external CLI upgrade", async () => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  const stateFile = join(t.project, ".loadouts/installers/codebase-memory.json"), state = json(stateFile);
  const relative = ".claude/skills/codebase-memory/SKILL.md", file = join(t.project, relative);
  const old = readFileSync(file, "utf8"), updated = old.replace("0.12.1", "0.12.2");
  state.previousFiles = {...state.files}; state.previousHooks = state.hooks; state.pending = true; state.version = "0.12.2";
  state.files[relative] = new Bun.CryptoHasher("sha256").update(updated).digest("hex");
  writeFileSync(stateFile, JSON.stringify(state));
  expect((await t.run(["install"], {FAKE_INSTALLER_VERSION: "0.12.2"})).code).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(updated);
  expect(readLock(t.project).installers!["codebase-memory"]!.version).toBe("0.12.2");
  expect(json(stateFile).pending).toBeUndefined();
});

test("launch preserves installer files without regenerating configuration", async () => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  mkdirSync(join(t.home, ".codex")); writeFileSync(join(t.home, ".codex/auth.json"), "{}");
  const bin = join(t.bin, "codex");
  writeFileSync(bin, `#!/bin/sh\nexec '${process.execPath}' -e 'const h = process.cwd() + "/.codex"; console.log(JSON.stringify({config: Bun.TOML.parse(await Bun.file(process.cwd() + "/.codex/config.toml").text()), hooks: await Bun.file(h + "/hooks.json").json()}))'\n`); chmodSync(bin, 0o755);
  const result = await t.run(["codex"]); expect(result.code).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.config.mcp_servers["codebase-memory-mcp"].command).toBe("codebase-memory-mcp");
  expect(output.hooks.hooks.SessionStart).toHaveLength(1);
});

test.each(["configure", "index"])("failed %s remains retryable", async failure => {
  const t = fixture();
  expect((await t.run(["install"], {FAKE_INSTALLER_FAIL: failure})).code).toBe(1);
  if (failure === "index") expect(readLock(t.project).incomplete).toBe(true);
  else expect(existsSync(join(t.project, ".codex/config.toml"))).toBe(false);
  expect((await t.run(["install"])).code).toBe(0);
  expect(readLock(t.project).incomplete).toBeUndefined();
  expect(existsSync(join(t.project, ".codex/agents/codebase-memory.toml"))).toBe(true);
});

test.each(["edited", "foreign", "symlink"])("protects %s project files", async kind => {
  const t = fixture(), file = join(t.project, ".claude/agents/codebase-memory.md");
  if (kind === "edited") expect((await t.run(["install"])).code).toBe(0);
  else mkdirSync(join(t.project, ".claude/agents"), {recursive: true});
  if (kind === "symlink") { const target = join(t.home, "personal"); writeFileSync(target, "personal"); symlinkSync(target, file); }
  else writeFileSync(file, "personal");
  const result = await t.run(["install"]);
  expect(result.code).toBe(1); expect(result.stderr).toContain("codebase-memory.md");
  expect(readFileSync(file, "utf8")).toBe("personal");
});

test("missing executable is actionable without changing the global setup", async () => {
  const t = fixture(); unlinkSync(t.executable);
  const result = await t.run(["install"], {PATH: t.bin});
  expect(result.code).toBe(3); expect(result.stderr).toContain("codebase-memory-mcp");
});

test("shared selections and harness removal retain the integration until the last selection", async () => {
  const t = fixture();
  writeFileSync(join(t.project, ".loadouts/catalog/other.yml"), "name: other\nitems: {graph: {installer: codebase-memory}}\n");
  expect((await t.run(["install"])).code).toBe(0);
  expect((await t.run(["add", "file:./.loadouts/catalog/other.yml"])).code).toBe(0);
  expect((await t.run(["remove", "memory"])).code).toBe(0);
  expect((await t.run(["harness", "remove", "claude-code"])).code).toBe(0);
  expect(existsSync(join(t.project, ".claude/agents/codebase-memory.md"))).toBe(false);
  expect(existsSync(join(t.project, ".codex/agents/codebase-memory.toml"))).toBe(true);
  expect(calls(t.log).filter(c => c.args[0] === "cli")).toHaveLength(1);
  expect((await t.run(["remove", "other"])).code).toBe(0);
  expect(existsSync(join(t.project, ".codex/agents/codebase-memory.toml"))).toBe(false);
});

function legacy(t: ReturnType<typeof fixture>) {
  const file = join(t.project, ".loadouts/installers/codebase-memory.json"), state = json(file);
  const archived: Record<string, string> = {};
  for (const table of ["files", "hooks"]) for (const path of Object.keys(state[table])) {
    const old = path.startsWith(".codex/") ? path.replace(".codex/", ".loadouts/codex-home/") : path.startsWith(".agents/") ? path.replace(".agents/", ".loadouts/codex-home/") : path.endsWith("codebase-memory.md") && path.startsWith(".loadouts/installers/") ? ".loadouts/codex-home/AGENTS.md" : path;
    if (old === path) continue;
    mkdirSync(join(t.project, old, ".."), {recursive: true});
    renameSync(join(t.project, path), join(t.project, old));
    state[table][old] = state[table][path]; delete state[table][path];
    archived[old] = readFileSync(join(t.project, old), "utf8");
  }
  writeFileSync(file, JSON.stringify(state));
  writeFileSync(join(t.project, ".loadouts/codex-home/sessions.jsonl"), "history");
  archived[".loadouts/codex-home/sessions.jsonl"] = "history";
  return {file, state, archived};
}

test("migrates legacy receipts without deleting history or indexing again, including removal", async () => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  const {file, archived} = legacy(t);
  expect((await t.run(["status", "--json"])).stdout).toContain('"needsInstall": true');
  expect((await t.run(["install"])).code).toBe(0);
  expect(json(file).indexedRoot).toBe(t.project);
  expect(Object.keys(json(file).files).some(p => p.startsWith(".loadouts/codex-home/"))).toBe(false);
  expect(existsSync(join(t.project, ".codex/hooks.json"))).toBe(true);
  expect(calls(t.log).filter(c => c.args[0] === "cli")).toHaveLength(1);
  expect((await t.run(["remove", "memory"])).code).toBe(0);
  for (const [path, text] of Object.entries(archived)) expect(readFileSync(join(t.project, path), "utf8")).toBe(text);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).not.toContain("Use codebase-memory before structural searches.");
});

test.each([".codex/agents/codebase-memory.toml", ".agents/skills/codebase-memory/SKILL.md", ".codex/hooks.json"])("native conflict at %s blocks all config mutation", async path => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  legacy(t);
  const config = join(t.project, ".codex/config.toml"), before = readFileSync(config, "utf8"), lock = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  mkdirSync(join(t.project, path, ".."), {recursive: true});
  const text = path.endsWith("json") ? JSON.stringify({hooks: {SessionStart: [{hooks: [{type: "command", command: "codebase-memory-mcp personal"}]}]}}) : "personal";
  writeFileSync(join(t.project, path), text);
  expect((await t.run(["install"])).code).toBe(1);
  expect(readFileSync(config, "utf8")).toBe(before);
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(lock);
  expect(readFileSync(join(t.project, path), "utf8")).toBe(text);
});

test("adopts matching committed native assets without a local receipt", async () => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  unlinkSync(join(t.project, ".loadouts/installers/codebase-memory.json"));
  expect((await t.run(["install"])).code).toBe(0);
  expect(json(join(t.project, ".codex/hooks.json")).hooks.SessionStart).toHaveLength(1);
});

test.each(["missing", "edited"])("handles %s archived assets safely", async kind => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  legacy(t);
  const path = join(t.project, ".loadouts/codex-home/agents/codebase-memory.toml");
  if (kind === "missing") unlinkSync(path); else writeFileSync(path, "personal");
  expect((await t.run(["install"])).code).toBe(kind === "missing" ? 0 : 1);
  if (kind === "edited") expect(readFileSync(path, "utf8")).toBe("personal");
});

test.each(["retry", "cancel"])("%s an interrupted migration preserves archived state", async action => {
  const t = fixture(); expect((await t.run(["install"])).code).toBe(0);
  const native = json(join(t.project, ".loadouts/installers/codebase-memory.json"));
  const profile = ".codex/agents/codebase-memory.toml", text = readFileSync(join(t.project, profile), "utf8");
  const {file, state, archived} = legacy(t);
  writeFileSync(join(t.project, profile), text);
  writeFileSync(file, JSON.stringify({...native, pending: true, previousFiles: state.files, previousHooks: state.hooks, files: {...state.files, ...native.files}}));
  expect((await t.run(action === "retry" ? ["install"] : ["remove", "memory"])).code).toBe(0);
  expect(existsSync(join(t.project, profile))).toBe(action === "retry");
  for (const [path, content] of Object.entries(archived)) expect(readFileSync(join(t.project, path), "utf8")).toBe(content);
  expect(calls(t.log).filter(c => c.args[0] === "cli")).toHaveLength(1);
});

test("rejects a native skill symlink before writing configuration and preserves root instructions", async () => {
  const t = fixture(), target = join(t.home, "personal");
  mkdirSync(target); writeFileSync(join(target, "SKILL.md"), "personal");
  mkdirSync(join(t.project, ".agents/skills"), {recursive: true});
  symlinkSync(target, join(t.project, ".agents/skills/codebase-memory"));
  writeFileSync(join(t.project, "AGENTS.md"), "Project instructions.\n");
  expect((await t.run(["install"])).code).toBe(1);
  expect(existsSync(join(t.project, ".codex/config.toml"))).toBe(false);
  expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("personal");
  unlinkSync(join(t.project, ".agents/skills/codebase-memory"));
  expect((await t.run(["install"])).code).toBe(0);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toStartWith("Project instructions.\n");
});

test.each(["git-named", "git-discovered", "package"])("installer does not overwrite a selected %s skill or delete it on cancellation", async source => {
  const t = fixture();
  const item = source === "package" ? {packageSkills: {include: ["@acme/memory"]}} : {skills: [source === "git-named" ? "acme/tools@codebase-memory" : "acme/codebase-memory"]};
  writeFileSync(join(t.project, ".loadouts/catalog/other.yml"), JSON.stringify({name: "other", items: {skill: item}}));
  writeFileSync(join(t.project, "loadouts.json"), JSON.stringify({harnesses: ["codex"], loadouts: {memory: {source: "file:./.loadouts/catalog/memory.yml"}, other: {source: "file:./.loadouts/catalog/other.yml"}}}));
  if (source === "package") {
    const pkg = join(t.project, "node_modules/@acme/memory"); mkdirSync(join(pkg, "skills/codebase-memory"), {recursive: true});
    writeFileSync(join(pkg, "package.json"), JSON.stringify({name: "@acme/memory", version: "1.0.0"}));
    writeFileSync(join(pkg, "skills/codebase-memory/SKILL.md"), "---\nname: codebase-memory\ndescription: Companion\n---\nPackage skill\n");
  }
  const result = await t.run(["install"]);
  expect(result.code).toBe(1); expect(result.stderr).toContain("codebase-memory");
  const skill = join(t.project, ".agents/skills/codebase-memory/SKILL.md");
  if (existsSync(skill)) expect(readFileSync(skill, "utf8")).not.toContain("Use the graph.");
  expect(existsSync(join(t.project, ".loadouts/installers/codebase-memory.json"))).toBe(false);
  const removed = await t.run(["remove", "memory"]);
  expect(removed.code, removed.stderr).toBe(0);
  expect(readFileSync(skill, "utf8")).toContain(source === "package" ? "Package skill" : "# codebase-memory");
  expect(json(join(t.project, "skills-lock.json")).skills["codebase-memory"].sourceType).toBe(source === "package" ? "node_modules" : "github");
});
