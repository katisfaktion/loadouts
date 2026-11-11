import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, rmSync, readdirSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, run, git, repo } from "./helpers";
import { version } from "../package.json";

test("init exposes tracked local YAML without adding an obsolete Codex ignore rule", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  git(t.project, "init", "-b", "main");
  writeFileSync(join(t.project, ".gitignore"), "node_modules/\n.loadouts/\n# keep me\n");
  expect((await run(["init", "--harness", "claude-code"], opts)).code).toBe(0);
  expect(existsSync(join(t.project, ".loadouts"))).toBe(true);
  expect(git(t.project, "ls-files", "--others", "--exclude-standard")).toContain(".loadouts/.gitkeep");
  expect(readFileSync(join(t.project, ".gitignore"), "utf8")).toBe("node_modules/\n# keep me\n");
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {}\n");
  expect(git(t.project, "ls-files", "--others", "--exclude-standard")).toContain(".loadouts/catalog/backend.yml");
  expect((await run(["init", "--harness", "claude-code"], opts)).stdout).toContain("Nothing changed.");
});

test("install cleans up the obsolete rule without changing other ignore entries", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  expect((await run(["init", "--harness", "claude-code"], opts)).code).toBe(0);
  const file = join(t.project, ".gitignore");
  const original = "# local\r\n.loadouts/codex-home/\r\n.loadouts/installers/\r\n";
  writeFileSync(file, original);
  expect((await run(["install"], opts)).code).toBe(0);
  expect(readFileSync(file, "utf8")).toBe("# local\r\n.loadouts/installers/\r\n");
});

test("local-only application works offline and requires explicit reapplication of edits", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  await run(["global", "configure", "--catalog", "/missing-catalog", "--harness", "claude-code"], opts);
  await run(["init"], opts);
  const file = join(t.project, ".loadouts/catalog/pipeline.yml");
  writeFileSync(file, "name: pipeline\nitems: {}\nconventions: first definition\n");
  expect((await run(["add", "file:./.loadouts/catalog/pipeline.yml"], opts)).code).toBe(0);
  const lockFile = join(t.project, "loadouts.lock.json"), before = JSON.parse(readFileSync(lockFile, "utf8"));
  expect(before.version).toBe(1); expect(before.catalog).toBeNull(); expect(before.local.pipeline).toBe(readFileSync(file, "utf8"));
  writeFileSync(file, "name: pipeline\nitems: {}\nconventions: edited definition\n");
  expect((await run(["harness", "add", "codex"], opts)).code).toBe(0);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("first definition");
  expect((await run(["update"], opts)).code).toBe(0);
  expect(JSON.parse(readFileSync(lockFile, "utf8")).local).toEqual(before.local);
  expect((await run(["add", "file:./.loadouts/catalog/pipeline.yml"], opts)).code).toBe(0);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("edited definition");
  expect(JSON.parse((await run(["status", "--json"], opts)).stdout).sources.pipeline).toBe("local");
});

test("explicit local source replaces shared while shared updates preserve draft files and snapshots", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  expect((await run(["add", "base", "backend", "--catalog", catalog], opts)).code).toBe(0);
  const file = join(t.project, ".loadouts/catalog/backend.yml");
  const original = readFileSync(join(catalog, "loadouts/backend.yml"), "utf8");
  writeFileSync(file, original + "conventions: applied local definition\n");
  expect((await run(["add", "file:./.loadouts/catalog/backend.yml", "--yes"], opts)).code).toBe(0);
  writeFileSync(file, original + "conventions: work in progress\n");
  const base = join(catalog, "loadouts/base.yml"); writeFileSync(base, readFileSync(base, "utf8").replace("Terse code", "Updated upstream"));
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Update shared base"); git(catalog, "tag", "v1.1.0");
  expect((await run(["update"], opts)).code).toBe(0);
  const text = readFileSync(join(t.project, "AGENTS.md"), "utf8");
  expect(text).toContain("applied local definition"); expect(text).toContain("Updated upstream"); expect(text).not.toContain("work in progress");
  expect(readFileSync(file, "utf8")).toContain("work in progress");
  const status = JSON.parse((await run(["status", "--json"], opts)).stdout);
  expect(status.sources).toEqual({base: "catalog", backend: "local"});
});

test("invalid or deleted local drafts cannot silently fall back; removal still works", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  await run(["add", "base", "--catalog", catalog], opts);
  const file = join(t.project, ".loadouts/catalog/backend.yml");
  writeFileSync(file, "name: backend\nitems: {}\n");
  expect((await run(["add", "file:./.loadouts/catalog/backend.yml"], opts)).code).toBe(0);
  const lockFile = join(t.project, "loadouts.lock.json"), before = readFileSync(lockFile, "utf8");
  writeFileSync(file, "name: backend\nitems: [invalid]\n");
  expect((await run(["add", "file:./.loadouts/catalog/backend.yml"], opts)).code).toBe(1);
  expect(readFileSync(lockFile, "utf8")).toBe(before);
  unlinkSync(file);
  const missing = await run(["add", "file:./.loadouts/catalog/backend.yml"], opts);
  expect(missing.code).toBe(1); expect(missing.stderr).toContain("restore");
  expect((await run(["show", "backend"], opts)).code).toBe(1);
  expect(readFileSync(lockFile, "utf8")).toBe(before);
  expect((await run(["remove", "backend"], opts)).code).toBe(0);
  expect((await run(["add", "backend"], opts)).code).toBe(0);
  expect(JSON.parse((await run(["status", "--json"], opts)).stdout).sources.backend).toBe("catalog");
});

test("changed local MCP preflight fails without modifying the applied snapshot", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  await run(["global", "configure", "--catalog", "/missing-catalog", "--harness", "claude-code"], opts);
  await run(["init", "--harness", "claude-code"], opts);
  const file = join(t.project, ".loadouts/catalog/server.yml");
  writeFileSync(file, `name: server\nitems: {x: {mcp: {test: {command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(repo + "/tests/fixtures/mcp-ok.ts")}]}}}}\n`);
  expect((await run(["add", "file:./.loadouts/catalog/server.yml"], opts)).code).toBe(0);
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  const mcp = readFileSync(join(t.project, ".mcp.json"), "utf8");
  writeFileSync(file, 'name: server\nitems: {x: {mcp: {test: {command: "false"}}}}\n');
  const r = await run(["add", "file:./.loadouts/catalog/server.yml"], opts);
  expect(r.code).toBe(1); expect(r.stderr).toContain("not reachable");
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
  expect(readFileSync(join(t.project, ".mcp.json"), "utf8")).toBe(mcp);
});

test("release locks reject malformed local snapshots", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  await run(["create", "draft"], opts);
  expect((await run(["add", "file:./.loadouts/catalog/draft.yml"], opts)).code).toBe(0);
  const file = join(t.project, "loadouts.lock.json"), lock = JSON.parse(readFileSync(file, "utf8"));
  expect(lock.version).toBe(1);
  lock.local.draft = "name: wrong\nitems: {}";
  writeFileSync(file, JSON.stringify(lock));
  expect((await run(["status"], opts)).code).toBe(1);
});

test("non-skill reconciliation failures persist incomplete state until a successful retry", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  await run(["global", "configure", "--catalog", "/missing-catalog", "--harness", "claude-code"], opts);
  await run(["init", "--harness", "claude-code"], opts);
  await run(["create", "draft"], opts);
  mkdirSync(join(t.project, "CLAUDE.md"));
  expect((await run(["add", "file:./.loadouts/catalog/draft.yml"], opts)).code).toBe(1);
  const file = join(t.project, "loadouts.lock.json");
  expect(JSON.parse(readFileSync(file, "utf8")).incomplete).toBe(true);
  rmSync(join(t.project, "CLAUDE.md"), {recursive: true});
  expect((await run(["add", "file:./.loadouts/catalog/draft.yml"], opts)).code).toBe(0);
  expect(JSON.parse(readFileSync(file, "utf8")).incomplete).toBeUndefined();
});

test("create writes a schema-linked draft without overwriting or escaping the catalog", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  await run(["init"], opts);
  expect((await run(["create", "pipeline"], opts)).code).toBe(0);
  const file = join(t.project, ".loadouts/catalog/pipeline.yml"), before = readFileSync(file, "utf8");
  expect(before.split("\n")[0]).toBe(`# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v${version}/schemas/v1/loadout.schema.json`);
  expect(Bun.YAML.parse(before)).toEqual({name: "pipeline", items: {}});
  expect((await run(["create", "pipeline"], opts)).code).toBe(1);
  expect(readFileSync(file, "utf8")).toBe(before);
  expect((await run(["create", "../../escape"], opts)).code).toBe(2);
  expect(existsSync(join(t.home, "escape.yml"))).toBe(false);
});

test("create works before init without setup, installers or project configuration writes", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, PATH: ""}};
  mkdirSync(join(t.project, ".git"));
  const result = await run(["create", "pipeline"], opts);
  expect(result.code, result.stderr).toBe(0);
  expect(readdirSync(t.home)).toEqual([]);
  expect(readdirSync(t.project).sort()).toEqual([".git", ".loadouts"]);
  expect(readdirSync(join(t.project, ".loadouts"))).toEqual(["catalog"]);
  expect(readdirSync(join(t.project, ".loadouts/catalog"))).toEqual(["pipeline.yml"]);
  const yaml = readFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "utf8");
  expect(yaml).toContain(`loadouts/v${version}/schemas/v1/loadout.schema.json`);
  expect(yaml).toContain("\nname: pipeline\nitems: {}");
  expect((await run(["validate", ".loadouts/catalog/pipeline.yml"], opts)).code).toBe(0);
});

test.each(["directory", "worktree file"])("create uses the nearest uninitialized Git root (%s)", async kind => {
  const t = tempEnv(), nested = join(t.project, "src/nested"); mkdirSync(nested, {recursive: true});
  if (kind === "directory") mkdirSync(join(t.project, ".git"));
  else writeFileSync(join(t.project, ".git"), "gitdir: /unused/worktree/metadata\n");
  const result = await run(["create", "draft"], {cwd: nested, env: {...t.env, PATH: ""}});
  expect(result.code, result.stderr).toBe(0);
  expect(existsSync(join(t.project, ".loadouts/catalog/draft.yml"))).toBe(true);
  expect(readdirSync(nested)).toEqual([]); expect(existsSync(join(t.project, "loadouts.json"))).toBe(false);
});

test("create from a shared definition works before init and emits authoring group syntax", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  mkdirSync(join(t.project, ".git"));
  const yaml = "name: workflow\nitems:\n  method:\n    kind: one_of\n    members:\n      small: {conventions: Keep it small.}\n    default: [small]\n  tools:\n    kind: any_of\n    members:\n      extra: {conventions: Optional guidance.}\n    default: []\n";
  writeFileSync(join(catalog, "loadouts/workflow.yml"), yaml);
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Add normalized group fixture"); git(catalog, "tag", "v1.1.0");
  expect((await run(["global", "configure", "--catalog", catalog, "--harness", "codex"], opts)).code).toBe(0);
  const result = await run(["create", "custom", "--from", "workflow"], opts);
  expect(result.code, result.stderr).toBe(0);
  const file = join(t.project, ".loadouts/catalog/custom.yml");
  const copied = Bun.YAML.parse(readFileSync(file, "utf8")) as any;
  expect(copied).toEqual({name: "custom", items: {
    method: {one_of: {small: {conventions: "Keep it small."}}, default: "small"},
    tools: {any_of: {extra: {conventions: "Optional guidance."}}, default: []},
  }});
  expect(existsSync(join(t.project, "loadouts.json"))).toBe(false);
  expect(existsSync(join(t.project, "loadouts.lock.json"))).toBe(false);
});

test.each([".loadouts", ".loadouts/catalog"])("create refuses symlinked %s before init", async path => {
  const t = tempEnv();
  mkdirSync(join(t.project, ".git"));
  if (path.includes("/")) mkdirSync(join(t.project, ".loadouts"));
  symlinkSync(t.home, join(t.project, path));
  const result = await run(["create", "draft"], {cwd: t.project, env: {...t.env, PATH: ""}});
  expect(result.code).toBe(1); expect(result.stderr).toContain("unsafe local catalog directory");
  expect(readdirSync(t.home)).toEqual([]); expect(existsSync(join(t.project, "loadouts.json"))).toBe(false);
});

test("a compiled release derives draft schema references from its versioned package metadata", async () => {
  const t = tempEnv(), build = join(t.home, "build"); mkdirSync(build);
  cpSync(join(repo, "src"), join(build, "src"), {recursive: true});
  cpSync(join(repo, "skills"), join(build, "skills"), {recursive: true});
  symlinkSync(join(repo, "node_modules"), join(build, "node_modules"));
  const pkg = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  writeFileSync(join(build, "package.json"), JSON.stringify({...pkg, version: "9.8.7"}));
  const binary = join(build, "loadouts"), env = {...process.env, ...t.env};
  const compiled = Bun.spawnSync([process.execPath, "build", "--compile", join(build, "src/cli.ts"), "--outfile", binary], {cwd: build, env});
  expect(compiled.exitCode, compiled.stderr.toString()).toBe(0);
  const initialized = Bun.spawnSync([binary, "init", "--harness", "codex"], {cwd: t.project, env});
  expect(initialized.exitCode, initialized.stderr.toString()).toBe(0);
  const created = Bun.spawnSync([binary, "create", "release-draft"], {cwd: t.project, env: {...env, PATH: ""}});
  expect(created.exitCode, created.stderr.toString()).toBe(0);
  expect(readFileSync(join(t.project, ".loadouts/catalog/release-draft.yml"), "utf8").split("\n")[0])
    .toBe("# yaml-language-server: $schema=https://raw.githubusercontent.com/katisfaktion/loadouts/v9.8.7/schemas/v1/loadout.schema.json");
});

test("local discovery merges names and unselected local drafts can be inspected from child directories", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["global", "configure", "--catalog", catalog, "--harness", "claude-code"], opts);
  await run(["init"], opts);
  expect((await run(["create", "custom", "--from", "backend"], opts)).code).toBe(0);
  const copied = Bun.YAML.parse(readFileSync(join(t.project, ".loadouts/catalog/custom.yml"), "utf8")) as any;
  expect(copied.name).toBe("custom"); expect(copied.items.runtime.default).toEqual(["bun"]);
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {}\nconventions: local definition\n");
  mkdirSync(join(t.project, "child"));
  const child = {...opts, cwd: join(t.project, "child")};
  const list = await run(["list", "--json"], child);
  expect(list.code).toBe(0); expect(JSON.parse(list.stdout)).toEqual(["backend", "base", "custom", "frontend"]);
  expect((await run(["list"], child)).stdout).toContain("backend (local + catalog; choose an explicit source)");
  const shown = await run(["show", "backend", "--json"], child);
  expect(shown.code).toBe(0); expect(JSON.parse(shown.stdout)).toMatchObject({conventions: "local definition", source: {kind: "local", path: ".loadouts/catalog/backend.yml"}});
  expect((await run(["show", "backend", "--catalog", catalog], child)).stdout).not.toContain("local definition");
});

test("doctor explains explicit local and shared sources and draft drift without applying anything", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  await run(["add", "backend", "--catalog", catalog], opts);
  const file = join(t.project, ".loadouts/catalog/backend.yml"), original = readFileSync(join(catalog, "loadouts/backend.yml"), "utf8");
  writeFileSync(file, original);
  const lockFile = join(t.project, "loadouts.lock.json"), before = readFileSync(lockFile, "utf8");
  let r = await run(["doctor", "--json"], opts);
  expect(r.code).toBe(1);
  let findings = JSON.parse(r.stdout).findings;
  expect(findings).toContainEqual(expect.objectContaining({kind: "local", message: expect.stringContaining("Applied source: catalog")}));
  expect(findings.some((f: any) => f.message.includes("explicit source") && f.message.includes(catalog))).toBe(true);
  expect(readFileSync(lockFile, "utf8")).toBe(before);
  expect((await run(["add", "file:./.loadouts/catalog/backend.yml", "--yes"], opts)).code).toBe(0);
  writeFileSync(file, original + "conventions: a new draft\n");
  const applied = readFileSync(lockFile, "utf8");
  r = await run(["doctor", "--json"], opts); findings = JSON.parse(r.stdout).findings;
  expect(findings.some((f: any) => f.kind === "local" && f.message.includes("Applied source: local"))).toBe(true);
  expect(findings).toContainEqual(expect.objectContaining({kind: "local", message: expect.stringContaining("differs"), fix: "loadouts install"}));
  expect(readFileSync(lockFile, "utf8")).toBe(applied);
  writeFileSync(file, "name: backend\nitems: [invalid]\n");
  r = await run(["doctor", "--json"], opts);
  expect(JSON.parse(r.stdout).findings.some((f: any) => f.kind === "local" && f.message.includes("invalid"))).toBe(true);
  unlinkSync(file);
  r = await run(["doctor", "--json"], opts);
  expect(JSON.parse(r.stdout).findings.some((f: any) => f.kind === "local" && f.message.includes("missing") && f.fix.includes("restore"))).toBe(true);
  expect(readFileSync(lockFile, "utf8")).toBe(applied);
});

test("doctor checks configured-catalog collisions before a local draft is applied", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["global", "configure", "--catalog", catalog, "--harness", "claude-code"], opts);
  await run(["init"], opts); await run(["create", "backend"], opts);
  const r = await run(["doctor", "--json"], opts);
  expect(r.code).toBe(1);
  expect(JSON.parse(r.stdout).findings.some((f: any) => f.kind === "local" && f.message.includes("Not applied"))).toBe(true);
});

test("doctor retains local findings when selected shared definitions are unavailable", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  expect((await run(["add", "base", "--catalog", catalog], opts)).code).toBe(0);
  await run(["create", "draft"], opts); await run(["add", "file:./.loadouts/catalog/draft.yml"], opts);
  const file = join(t.project, ".loadouts/catalog/draft.yml"), lockFile = join(t.project, "loadouts.lock.json"), before = readFileSync(lockFile, "utf8");
  writeFileSync(file, "name: draft\nitems: [invalid]\n");
  rmSync(catalog, {recursive: true}); rmSync(t.env.LOADOUTS_CACHE!, {recursive: true});
  const r = await run(["doctor", "--json"], opts);
  expect(r.code).toBe(1); expect(r.stdout).toContain("findings");
  const findings = JSON.parse(r.stdout).findings;
  expect(findings.some((f: any) => f.message.includes(".loadouts/catalog/draft.yml is invalid"))).toBe(true);
  expect(findings.some((f: any) => f.message.includes("Cannot check applied definitions"))).toBe(true);
  expect(readFileSync(lockFile, "utf8")).toBe(before);
  expect(readFileSync(file, "utf8")).toBe("name: draft\nitems: [invalid]\n");
});

test("create normalizes nested internal groups and preserves member includes", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  mkdirSync(join(t.project, ".git"));
  const value = {name: "nested", items: {container: {conventions: "Keep parent", items: {language: {kind: "one_of", members: {python: {includes: {testing: {source: "github:acme/catalog/testing"}}, items: {extras: {kind: "any_of", members: {coverage: {}}, default: []}}}}, default: ["python"]}}}}};
  writeFileSync(join(catalog, "loadouts/nested.yml"), Bun.YAML.stringify(value));
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Nested normalized fixture"); git(catalog, "tag", "v1.1.0");
  expect((await run(["global", "configure", "--catalog", catalog, "--harness", "codex"], opts)).code).toBe(0);
  const result = await run(["create", "custom", "--from", "nested"], opts);
  expect(result.code, result.stderr).toBe(0);
  expect(Bun.YAML.parse(readFileSync(join(t.project, ".loadouts/catalog/custom.yml"), "utf8"))).toEqual({name: "custom", items: {container: {conventions: "Keep parent", items: {language: {one_of: {python: {includes: {testing: {source: "github:acme/catalog/testing"}}, items: {extras: {any_of: {coverage: {}}, default: []}}}}, default: "python"}}}}});
});
test.each([
  ["name: compose\nincludes: {testing: {source: 'github:acme/catalog/testing'}}", true],
  ["name: wrong\nitems: {}", false],
  ["name: compose\nitems: {x: &cycle {items: {again: *cycle}}}", false],
])("create handles includes-only and rejects bad source names or aliases: %s", async (yaml, valid) => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  mkdirSync(join(t.project, ".git"));
  writeFileSync(join(catalog, "loadouts/compose.yml"), yaml);
  git(catalog, "add", "."); git(catalog, "commit", "-m", "Create boundary fixture"); git(catalog, "tag", "v1.1.0");
  expect((await run(["global", "configure", "--catalog", catalog, "--harness", "codex"], opts)).code).toBe(0);
  const result = await run(["create", "custom", "--from", "compose"], opts);
  expect(result.code === 0, result.stderr).toBe(valid);
  expect(existsSync(join(t.project, ".loadouts/catalog/custom.yml"))).toBe(valid);
  if (valid) expect(Bun.YAML.parse(readFileSync(join(t.project, ".loadouts/catalog/custom.yml"), "utf8"))).toEqual({name: "custom", includes: {testing: {source: "github:acme/catalog/testing"}}});
});
