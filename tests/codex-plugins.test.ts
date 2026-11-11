import {test, expect} from "bun:test";
import {existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, symlinkSync, cpSync} from "node:fs";
import {join} from "node:path";
import {tempEnv, repo, run, fixtureCatalog} from "./helpers";
import {readLock} from "../src/lock";

const plugin = (name: string, marketplace = "team", source = "acme/team") => `{codex: {plugin: ${name}@${marketplace}, marketplace: ${source}}}`;
async function setup(items = `review: ${plugin("review")}`) {
  const t = tempEnv(), bin = join(t.project, "bin"), log = join(t.project, "codex-calls.jsonl");
  mkdirSync(bin); mkdirSync(join(t.home, ".codex"));
  writeFileSync(join(bin, "codex"), `#!${process.execPath}\nimport ${JSON.stringify(join(repo, "tests/fixtures/fake-codex.ts"))};\n`, {mode: 0o755});
  const opts = {cwd: t.project, env: {...t.env, PATH: `${bin}:${process.env.PATH}`, FAKE_CODEX_LOG: log, FAKE_CODEX_USER_HOME: join(t.home, ".codex")}};
  expect((await run(["init", "--harness", "claude-code,codex"], opts)).code).toBe(0);
  const yaml = (items: string) => writeFileSync(join(t.project, ".loadouts/catalog/work.yml"), `name: work\nitems: {${items}}\n`);
  yaml(items);
  const calls = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(s => JSON.parse(s)) : [];
  const file = join(t.project, ".codex/config.toml");
  const config = () => Bun.TOML.parse(readFileSync(file, "utf8")) as any;
  const cache = join(t.home, ".codex/plugins/cache/team/review/1.0.0");
  return {...t, opts, calls, file, config, cache, yaml};
}
const add = ["add", "file:./.loadouts/catalog/work.yml"];
const adds = (t: Awaited<ReturnType<typeof setup>>) => t.calls().filter(c => c.args[1] === "add");

test("native config preserves settings and staged plugin installation leaves global enablement unchanged", async () => {
  const t = await setup(); mkdirSync(join(t.project, ".codex"));
  const global = join(t.home, ".codex/config.toml"), original = 'model = "personal"\n[plugins."own@personal"]\nenabled = true\n'; writeFileSync(global, original);
  writeFileSync(t.file, 'model = "project"\n[mcp_servers.personal]\ncommand = "own"\n');
  const r = await run(add, t.opts); expect(r.code, r.stderr).toBe(0);
  expect(t.config()).toMatchObject({model: "project", mcp_servers: {personal: {command: "own"}}, marketplaces: {team: {source_type: "git", source: "https://github.com/acme/team.git"}}, plugins: {"review@team": {enabled: true}}});
  expect(t.config().projects).toBeUndefined(); expect(existsSync(join(t.project, ".codex/auth.json"))).toBe(false);
  expect(readFileSync(global, "utf8")).toBe(original);
  expect(existsSync(join(t.cache, ".codex-plugin/plugin.json"))).toBe(true);
  expect(readLock(t.project).version).toBe(1); expect(readLock(t.project).installed["codex-plugin:review@team"]).toEqual([]);
  expect(adds(t)).toHaveLength(1); expect(adds(t)[0].home).not.toBe(join(t.home, ".codex"));
  const files = [t.file, global, join(t.cache, ".codex-plugin/plugin.json"), join(t.project, "loadouts.lock.json")];
  const before = files.map(f => [readFileSync(f, "utf8"), statSync(f).mtimeMs]);
  expect((await run(["install"], t.opts)).stdout.trim()).toBe("Nothing changed.");
  expect(files.map(f => [readFileSync(f, "utf8"), statSync(f).mtimeMs])).toEqual(before); expect(adds(t)).toHaveLength(1);
  expect((await run(["codex", "--help"], t.opts)).code).toBe(0); expect(readFileSync(t.file, "utf8")).toBe(before[0]![0]);
  expect((await run(["harness", "remove", "codex"], t.opts)).code).toBe(0);
  expect(t.config().plugins["review@team"]).toBeUndefined(); expect(existsSync(t.cache)).toBe(true); expect(readFileSync(global, "utf8")).toBe(original);
  expect(t.calls().some(c => c.args.includes("remove"))).toBe(false);
});

test("adding marketplaces preserves inline native policy tables and other marketplaces", async () => {
  const t = await setup(); expect((await run(add, t.opts)).code).toBe(0);
  writeFileSync(t.file, 'marketplaces = { team = { source_type = "git", source = "https://github.com/acme/team.git" }, personal = { source_type = "local", source = "/tools/plugins" } }\nplugins = { "review@team" = { enabled = true, mcp_servers = { docs = { enabled_tools = ["search"] } } }, "own@personal" = { enabled = false } }\nhooks = { state = { approved = { trusted_hash = "keep", enabled = false } } }\n');
  const before = t.config(); t.yaml(`review: ${plugin("review")}, new: ${plugin("new", "extra", "acme/extra")}`);
  const r = await run(["install"], t.opts); expect(r.code, r.stderr).toBe(0);
  expect(t.config().marketplaces).toEqual({...before.marketplaces, extra: {source_type: "git", source: "https://github.com/acme/extra.git"}});
  expect(t.config().plugins).toEqual({...before.plugins, "new@extra": {enabled: true}}); expect(t.config().hooks).toEqual(before.hooks);
  expect((await run(["install"], t.opts)).stdout.trim()).toBe("Nothing changed.");
});

test("switching plugins retains shared marketplaces and source changes explicitly refresh caches", async () => {
  const t = await setup(`choice: {one_of: {a: ${plugin("first")}, b: ${plugin("second")}}, default: a}, keep: ${plugin("keep")}`);
  expect((await run(add, t.opts)).code).toBe(0); expect((await run(["switch", "work/choice", "b"], t.opts)).code).toBe(0);
  expect(t.config().plugins["first@team"]).toBeUndefined(); expect(t.config().plugins["second@team"].enabled).toBe(true);
  t.yaml(`review: ${plugin("review", "team", "other/team")}`);
  // Remove obsolete explicit group choices along with the changed definition.
  const manifest = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")); delete manifest.loadouts.work.choices; writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(manifest));
  expect((await run(["install"], t.opts)).code).toBe(0); expect(t.config().marketplaces.team.source).toBe("https://github.com/other/team.git");
  const count = adds(t).length; expect((await run(["update"], t.opts)).code).toBe(0); expect(adds(t)).toHaveLength(count + 1);
  expect((await run(["remove", "work"], t.opts)).code).toBe(0); expect(t.config().marketplaces).toEqual({});
});

test.each(["retry", "cancel"])("failed staged installs support %s without global changes", async next => {
  const t = await setup(); const failed = await run(add, {...t.opts, env: {...t.opts.env, FAKE_CODEX_FAIL: "add review@team"}});
  expect(failed.code).toBe(1); expect(readLock(t.project).pending).toContain("codex-plugin:review@team");
  expect(existsSync(join(t.home, ".codex/config.toml"))).toBe(false);
  expect((await run(next === "retry" ? ["install"] : ["remove", "work"], t.opts)).code).toBe(0);
  expect(readLock(t.project).pending).toBeUndefined(); expect(readLock(t.project).incomplete).toBeUndefined();
  expect(t.config().plugins["review@team"]?.enabled).toBe(next === "retry" ? true : undefined);
});

test("marketplace conflicts and differing unmanaged plugins fail before native commands", async () => {
  const conflict = await setup(`a: ${plugin("first")}, b: ${plugin("second", "team", "other/team")}`);
  expect((await run(add, conflict.opts)).code).toBe(1); expect(conflict.calls()).toEqual([]);
  const t = await setup(); mkdirSync(join(t.project, ".codex")); const before = '[plugins."review@team"]\nenabled = false\n'; writeFileSync(t.file, before);
  expect((await run(add, t.opts)).code).toBe(1); expect(t.calls()).toEqual([]); expect(readFileSync(t.file, "utf8")).toBe(before);
});


test("missing cache and missing project declarations are repaired without changing lock selections", async () => {
  const t = await setup(); expect((await run(add, t.opts)).code).toBe(0);
  const lock = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  rmSync(join(t.home, ".codex/plugins"), {recursive: true});
  expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBe(true);
  expect((await run(["codex"], t.opts)).stderr).toContain("loadouts install");
  expect((await run(["install"], t.opts)).code).toBe(0); expect(existsSync(t.cache)).toBe(true); expect(adds(t)).toHaveLength(2);
  rmSync(join(t.project, ".codex"), {recursive: true});
  expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBe(true);
  expect((await run(["codex"], t.opts)).stderr).toContain("loadouts install");
  expect((await run(["install"], t.opts)).code).toBe(0); expect(t.config().plugins["review@team"].enabled).toBe(true);
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(lock);
});

test("fresh checkout restores caches from tracked declarations without local ownership receipts", async () => {
  const a = await setup(); expect((await run(add, a.opts)).code).toBe(0); const b = await setup();
  for (const file of ["loadouts.json", "loadouts.lock.json", ".codex/config.toml"]) { mkdirSync(join(b.project, file, ".."), {recursive: true}); cpSync(join(a.project, file), join(b.project, file)); }
  expect((await run(["install"], b.opts)).code).toBe(0); expect(existsSync(b.cache)).toBe(true); expect(existsSync(join(b.home, ".codex/config.toml"))).toBe(false);
});

test.each(["namespace", "json", "errors", "outside", "symlink", "version"])("invalid native result is rejected: %s", async kind => {
  const t = await setup(); const r = await run(add, {...t.opts, env: {...t.opts.env, FAKE_CODEX_INVALID: kind}});
  expect(r.code).toBe(1);
  const reasons: Record<string, string> = {namespace: "marketplace identity", json: "invalid plugin JSON", errors: "marketplace errors", outside: "unsafe plugin cache path", symlink: "unsupported Codex cache asset", version: "unsafe Codex cache path"};
  expect(r.stderr).toContain(reasons[kind]!);
  expect(existsSync(join(t.cache, ".codex-plugin/plugin.json"))).toBe(false);
  expect(readLock(t.project).incomplete).toBe(true); expect(existsSync(join(t.home, ".codex/config.toml"))).toBe(false);
  expect((await run(["remove", "work"], t.opts)).code).toBe(0);
});

test("cache destination symlinks never overwrite user files", async () => {
  const t = await setup(), target = join(t.home, "personal"); mkdirSync(target); writeFileSync(join(target, "keep"), "personal");
  mkdirSync(join(t.home, ".codex/plugins")); symlinkSync(target, join(t.home, ".codex/plugins/cache"));
  expect((await run(add, t.opts)).code).toBe(1); expect(readFileSync(join(target, "keep"), "utf8")).toBe("personal"); expect(existsSync(join(target, "team"))).toBe(false);
});

test("missing Codex executable does not claim successful installation", async () => {
  const t = await setup(); const r = await run(add, {...t.opts, env: {...t.opts.env, PATH: "/missing-loadouts-bin"}});
  expect(r.code).toBe(3); expect(readLock(t.project).installed["codex-plugin:review@team"]).toBeUndefined();
});

test("doctor and inspection use native Codex project declarations", async () => {
  const t = await setup(`choice: {one_of: {a: ${plugin("first")}, b: ${plugin("second")}}, default: b}`);
  expect((await run(["global", "configure", "--catalog", fixtureCatalog(), "--harness", "claude-code,codex"], t.opts)).code).toBe(0);
  expect((await run(add, t.opts)).code).toBe(0);
  writeFileSync(t.file, readFileSync(t.file, "utf8").replace('"enabled" = true', '"enabled" = false') + '[plugins."first@team"]\nenabled=true\n');
  const r = await run(["doctor", "--json"], t.opts); expect(r.code).toBe(1); const findings = JSON.parse(r.stdout).findings;
  expect(findings).toContainEqual(expect.objectContaining({kind: "local", message: expect.stringContaining("second@team")}));
  expect(findings).toContainEqual(expect.objectContaining({kind: "conflict", message: expect.stringContaining("work/choice")}));
  const inspection = JSON.parse((await run(["inspect", "--json"], t.opts)).stdout);
  expect(inspection.plugins).toContainEqual(expect.objectContaining({id: "second@team", harness: "codex", source: "acme/team", scope: "project", path: t.file}));
});

test("selecting an already cached plugin reuses its contents without implicit update", async () => {
  const t = await setup(); mkdirSync(join(t.cache, ".codex-plugin"), {recursive: true});
  writeFileSync(join(t.cache, ".codex-plugin/plugin.json"), JSON.stringify({name: "review", version: "1.0.0"}));
  writeFileSync(join(t.cache, "keep"), "existing verified cache");
  expect((await run(add, t.opts)).code).toBe(0);
  expect(readFileSync(join(t.cache, "keep"), "utf8")).toBe("existing verified cache"); expect(adds(t)).toHaveLength(0);
  expect(readLock(t.project).pending).toBeUndefined();
});

test.each(["marketplace upgrade team", "list --marketplace team --available"])("source replacement survives failed %s and retries the plugin", async failure => {
  const t = await setup(); expect((await run(add, t.opts)).code).toBe(0);
  t.yaml(`review: ${plugin("review", "team", "other/team")}`);
  expect((await run(["install"], {...t.opts, env: {...t.opts.env, FAKE_CODEX_FAIL: failure}})).code).toBe(1);
  expect(readLock(t.project).pending).toContain("codex-plugin:review@team");
  expect((await run(["install"], t.opts)).code).toBe(0);
  expect(readFileSync(join(t.cache, "skills/review/SKILL.md"), "utf8")).toContain("https://github.com/other/team.git");
  expect(readLock(t.project).pending).toBeUndefined();
});

test("explicit update retains replacement intent after marketplace refresh failure", async () => {
  const t = await setup(); expect((await run(add, t.opts)).code).toBe(0);
  const count = adds(t).length;
  expect((await run(["update"], {...t.opts, env: {...t.opts.env, FAKE_CODEX_FAIL: "marketplace upgrade team"}})).code).toBe(1);
  expect((await run(["install"], t.opts)).code).toBe(0);
  expect(adds(t)).toHaveLength(count + 1);
});

test.each(["missing", "invalid", "symlink"])("an %s older cache version does not hide a valid plugin", async kind => {
  const t = await setup(); expect((await run(add, t.opts)).code).toBe(0);
  const old = join(t.cache, "../0.9.0"), outside = join(t.home, "outside-plugin");
  if (kind === "symlink") { mkdirSync(outside); symlinkSync(outside, old); }
  else { mkdirSync(join(old, ".codex-plugin"), {recursive: true}); if (kind === "invalid") writeFileSync(join(old, ".codex-plugin/plugin.json"), "invalid"); }
  expect((await run(["install"], t.opts)).code).toBe(0);
  expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBeUndefined();
  expect((await run(["codex"], t.opts)).code).toBe(0);
});
