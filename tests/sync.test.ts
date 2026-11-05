import { test, expect } from "bun:test";
import { readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, run, git } from "./helpers";

export async function projectFixture(harness = "claude-code,codex") {
  const t = tempEnv(), catalog = fixtureCatalog();
  t.env.FAKE_SKILLS_LOG = join(t.project, "calls.jsonl");
  t.env.FAKE_SKILLS = JSON.stringify({"obra/superpowers": ["superpowers"], "DietrichGebert/ponytail": ["ponytail", "ponytail-audit"], "acme/bun-skills": ["bun"], "acme/go-skills": ["go", "go-extra"], "addyosmani/agent-skills": ["agent-skills"]});
  const opts = {cwd: t.project, env: t.env};
  expect((await run(["init", "--harness", harness], opts)).code).toBe(0);
  expect((await run(["install"], opts)).code).toBe(0);
  const text = (file: string) => readFileSync(join(t.project, file), "utf8");
  const lock = () => JSON.parse(text("loadouts.lock.json"));
  return {...t, catalog, opts, text, lock};
}
async function added() {
  const t = await projectFixture();
  const r = await run(["add", "base", "frontend", "backend", "--catalog", t.catalog], t.opts);
  expect(r.stderr).toBe(""); expect(r.code).toBe(0); return t;
}
test("add generates all harness files and is idempotent", async () => {
  const t = await added();
  expect(JSON.parse(t.text(".claude/settings.json")).enabledPlugins).toEqual({"superpowers@superpowers-dev": true, "ponytail@ponytail": true});
  expect(JSON.parse(t.text(".mcp.json")).mcpServers.shadcn).toBeDefined();
  expect((Bun.TOML.parse(t.text(".codex/config.toml")) as any).mcp_servers.shadcn).toBeDefined();
  expect(t.text("AGENTS.md")).toContain("<!-- loadouts:begin -->");
  expect(t.text("CLAUDE.md")).toContain("@AGENTS.md"); expect(t.text(".gitignore")).toContain(".loadouts/");
  const mtime = statSync(join(t.project, "loadouts.lock.json")).mtimeMs;
  const r = await run(["add", "base", "frontend", "backend", "--catalog", t.catalog], t.opts);
  expect(r.code).toBe(0); expect(r.stdout.trim()).toBe("Nothing changed.");
  expect(statSync(join(t.project, "loadouts.lock.json")).mtimeMs).toBe(mtime);
});
test("switch replaces skills, plugins and routing", async () => {
  const t = await added();
  expect((await run(["switch", "base/methodology", "agent-skills"], t.opts)).code).toBe(0);
  expect(JSON.parse(t.text(".claude/settings.json")).enabledPlugins["superpowers@superpowers-dev"]).toBeUndefined();
  const calls = t.text("calls.jsonl").trim().split("\n").map(s => JSON.parse(s));
  expect(calls).toContainEqual(["remove", "superpowers", "-a", "codex", "-y"]);
  expect(calls).toContainEqual(["add", "addyosmani/agent-skills", "-s", "*", "-a", "codex", "-y", "--json"]);
  expect(t.text("AGENTS.md")).toContain("agent-skills"); expect(t.text("AGENTS.md")).not.toContain("superpowers");
});
test("enable, disable and remove reconcile their artifact sets", async () => {
  const t = await added();
  expect((await run(["enable", "backend/runtime", "go"], t.opts)).code).toBe(0);
  expect(t.lock().installed["skill:codex:acme/go-skills"]).toEqual(["go", "go-extra"]);
  expect((await run(["disable", "backend/runtime", "go"], t.opts)).code).toBe(0);
  expect(t.lock().installed["skill:codex:acme/go-skills"]).toBeUndefined();
  expect((await run(["remove", "frontend"], t.opts)).code).toBe(0);
  expect(JSON.parse(t.text(".mcp.json")).mcpServers.shadcn).toBeUndefined();
  expect((Bun.TOML.parse(t.text(".codex/config.toml")) as any).mcp_servers?.shadcn).toBeUndefined();
});
test("failed sync retains prior progress and retries pending artifacts", async () => {
  const t = await added(), before = t.lock().installed;
  const r = await run(["enable", "backend/runtime", "go"], {...t.opts, env: {...t.env, FAKE_SKILLS_FAIL: "acme/go-skills"}});
  expect(r.code).toBe(1);
  for (const [key, value] of Object.entries(before)) expect(t.lock().installed[key]).toEqual(value);
  expect((await run(["enable", "backend/runtime", "go"], t.opts)).code).toBe(0);
  expect(t.lock().installed["skill:codex:acme/go-skills"]).toEqual(["go", "go-extra"]);
  expect(t.lock().pending).toBeUndefined();
});
test("partial install names survive in the lock for retry and removal", async () => {
  const t = await projectFixture("codex");
  await run(["add", "backend", "--catalog", t.catalog], t.opts);
  const args = ["enable", "backend/runtime", "go"];
  expect((await run(args, {...t.opts, env: {...t.env, FAKE_SKILLS_PARTIAL: "acme/go-skills"}})).code).toBe(1);
  expect(t.lock().installed["skill:codex:acme/go-skills"]).toEqual(["go"]);
  expect(t.lock().pending).toEqual(["skill:codex:acme/go-skills"]);
  expect((await run(args, t.opts)).code).toBe(0);
  expect(t.lock().installed["skill:codex:acme/go-skills"]).toEqual(["go", "go-extra"]);
  expect(t.lock().pending).toBeUndefined();
  await run(["disable", "backend/runtime", "go"], t.opts);
  await run(args, {...t.opts, env: {...t.env, FAKE_SKILLS_PARTIAL: "acme/go-skills"}});
  expect((await run(["remove", "backend"], t.opts)).code).toBe(0);
  expect(existsSync(join(t.project, ".agents/skills/go"))).toBe(false);
  expect(t.lock().installed).toEqual({}); expect(t.lock().pending).toBeUndefined();
});
test("unreachable MCP and broken markers fail before any project mutation", async () => {
  const t = await projectFixture();
  writeFileSync(join(t.catalog, "loadouts/frontend.yml"), 'name: frontend\nitems: {ui: {mcp: {shadcn: {command: "false"}}}}\n');
  git(t.catalog, "add", "."); git(t.catalog, "commit", "-m", "Unreachable server"); git(t.catalog, "tag", "v1.1.0");
  const before = t.text("loadouts.lock.json");
  expect((await run(["add", "frontend", "--catalog", t.catalog], t.opts)).code).toBe(1);
  expect(t.text("loadouts.lock.json")).toBe(before); expect(existsSync(join(t.project, ".mcp.json"))).toBe(false);
  writeFileSync(join(t.project, "AGENTS.md"), "mine\n<!-- loadouts:begin -->");
  expect((await run(["add", "base", "--catalog", t.catalog], t.opts)).code).toBe(1);
  expect(t.text("loadouts.lock.json")).toBe(before); expect(existsSync(join(t.project, "calls.jsonl"))).toBe(false);
});
test("invalid choices and wrong group commands are usage errors", async () => {
  const t = await added();
  for (const args of [["switch", "base/nosuch", "x"], ["switch", "backend/runtime", "go"], ["enable", "base/methodology", "agent-skills"], ["add", "base", "--with", "base/methodology=superpowers,agent-skills"], ["add", "backend", "--with", "backend/runtime=nosuch"]]) {
    expect((await run(args, t.opts)).code).toBe(2);
  }
});
test("harness removal clears owned artifacts and status is JSON", async () => {
  const t = await added();
  expect((await run(["harness", "remove", "claude-code"], t.opts)).code).toBe(0);
  expect(JSON.parse(t.text(".claude/settings.json")).enabledPlugins).toEqual({});
  const r = await run(["status", "--json"], t.opts);
  expect(r.code).toBe(0); expect(JSON.parse(r.stdout).harnesses).toEqual(["codex"]);
  expect((await run(["harness", "add", "claude-code"], t.opts)).code).toBe(0);
});
test("conflicting MCP definitions fail before writes", async () => {
  const t = await projectFixture();
  for (const [name, command] of [["one", "true"], ["two", "false"]]) writeFileSync(join(t.catalog, `loadouts/${name}.yml`), `name: ${name}\nitems: {x: {mcp: {same: {command: ${JSON.stringify(command)}}}}}`);
  git(t.catalog, "add", "."); git(t.catalog, "commit", "-m", "Conflicting servers"); git(t.catalog, "tag", "v1.1.0");
  const before = t.text("loadouts.lock.json"), r = await run(["add", "one", "two", "--catalog", t.catalog], t.opts);
  expect(r.code).toBe(1); expect(r.stderr).toContain("one/x"); expect(r.stderr).toContain("two/x"); expect(t.text("loadouts.lock.json")).toBe(before);
});

test("update preserves choices and aborts if a selected member disappears", async () => {
  const t = await projectFixture();
  await run(["add", "base", "--catalog", t.catalog], t.opts);
  const file = join(t.catalog, "loadouts/base.yml");
  writeFileSync(file, readFileSync(file, "utf8").replace("Terse code, platform features before dependencies.", "Updated conventions."));
  git(t.catalog, "add", "."); git(t.catalog, "commit", "-m", "New conventions"); git(t.catalog, "tag", "v1.1.0");
  const r = await run(["update"], t.opts);
  expect(r.code).toBe(0); expect(r.stdout).toContain("v1.0.0 → v1.1.0");
  expect(t.lock().catalog.ref).toBe("v1.1.0"); expect(t.lock().loadouts.base.methodology).toEqual(["superpowers"]); expect(t.text("AGENTS.md")).toContain("Updated conventions.");
  const yaml = readFileSync(file, "utf8").replace(/      superpowers:\n        claude:.*\n        codex:.*\n/, "").replace("default: superpowers", "default: agent-skills");
  writeFileSync(file, yaml); git(t.catalog, "add", "."); git(t.catalog, "commit", "-m", "Removed selected member"); git(t.catalog, "tag", "v1.2.0");
  const before = t.text("loadouts.lock.json");
  const failed = await run(["update"], t.opts);
  expect(failed.code).toBe(1); expect(failed.stderr).toContain("alternative superpowers no longer exists"); expect(t.text("loadouts.lock.json")).toBe(before);
});
test("update checks changed MCP definitions before writing them", async () => {
  const t = await added();
  const file = join(t.catalog, "loadouts/frontend.yml");
  writeFileSync(file, 'name: frontend\nitems: {ui: {mcp: {shadcn: {command: "false"}}}}\n');
  git(t.catalog, "add", "."); git(t.catalog, "commit", "-m", "Changed server"); git(t.catalog, "tag", "v1.1.0");
  const before = t.text("loadouts.lock.json"), mcp = t.text(".mcp.json");
  expect((await run(["update"], t.opts)).code).toBe(1);
  expect(t.text("loadouts.lock.json")).toBe(before); expect(t.text(".mcp.json")).toBe(mcp);
});

test.each([
  [".mcp.json", {mcpServers: {shadcn: {command: "my-server"}}}, "frontend"],
  [".claude/settings.json", {enabledPlugins: {"superpowers@superpowers-dev": false}}, "base"],
  [".claude/settings.json", {extraKnownMarketplaces: {"superpowers-dev": {source: {source: "github", repo: "mine/repo"}}}}, "base"],
])("unowned collisions in %s fail before installs and preserve bytes", async (file, data, name) => {
  const t = await projectFixture(), path = join(t.project, file);
  const {mkdirSync} = await import("node:fs"); const {dirname} = await import("node:path");
  mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, JSON.stringify(data));
  const before = t.text("loadouts.lock.json"), original = t.text(file);
  const r = await run(["add", name, "--catalog", t.catalog], t.opts);
  expect(r.code).toBe(1); expect(r.stderr).toContain("already exists");
  expect(t.text(file)).toBe(original); expect(t.text("loadouts.lock.json")).toBe(before);
  expect(existsSync(join(t.project, "calls.jsonl"))).toBe(false);
});
test("successful retry retains earlier partial names until removal", async () => {
  const t = await projectFixture("codex");
  const first = {...t.opts, env: {...t.env, FAKE_SKILLS: JSON.stringify({"acme/bun-skills": ["old", "other"]}), FAKE_SKILLS_PARTIAL: "acme/bun-skills"}};
  expect((await run(["add", "backend", "--catalog", t.catalog], first)).code).toBe(1);
  const retry = {...t.opts, env: {...t.env, FAKE_SKILLS: JSON.stringify({"acme/bun-skills": ["other"]})}};
  expect((await run(["add", "backend"], retry)).code).toBe(0);
  expect(t.lock().installed["skill:codex:acme/bun-skills"]).toEqual(["old", "other"]);
  expect((await run(["remove", "backend"], t.opts)).code).toBe(0);
  expect(existsSync(join(t.project, ".agents/skills/old"))).toBe(false);
});
