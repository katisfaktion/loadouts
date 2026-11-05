import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, cpSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, run, git } from "./helpers";

function setup(skills = true) {
  const t = tempEnv(), opts = {cwd: t.project, env: {...t.env, FAKE_SKILLS_LOG: join(t.home, "calls.jsonl")}};
  mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  const file = join(t.project, ".loadouts/catalog/work.yml");
  writeFileSync(file, `name: work\nitems: ${skills ? '{tools: {skills: [acme/tools@review]}}' : '{}'}\nconventions: original\n`);
  const manifest = {harnesses: ["claude-code", "codex"], loadouts: {work: {source: "file:./.loadouts/catalog/work.yml"}}};
  const save = (m: any) => writeFileSync(join(t.project, "loadouts.json"), JSON.stringify(m)); save(manifest);
  const lock = () => JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8"));
  return {...t, opts, file, manifest, save, lock};
}
test("install sets up a manifest-only project and a fresh clone without repeating successful installers", async () => {
  const t = setup(); expect((await run(["install"], t.opts)).code).toBe(0);
  expect(t.lock().version).toBe(6); expect(t.lock().installed["skill:codex:acme/tools@review"]).toEqual(["review"]);
  expect(existsSync(join(t.project, ".claude/skills/review/SKILL.md"))).toBe(true);
  const before = readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8"), mtime = statSync(join(t.project, "loadouts.lock.json")).mtimeMs;
  expect((await run(["install"], t.opts)).stdout.trim()).toBe("Nothing changed.");
  expect(readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8")).toBe(before); expect(statSync(join(t.project, "loadouts.lock.json")).mtimeMs).toBe(mtime);
  git(t.project, "init", "-b", "main"); git(t.project, "add", "loadouts.json", "loadouts.lock.json", "skills-lock.json", ".loadouts/catalog", ".gitignore"); git(t.project, "commit", "-m", "Selected setup");
  const other = tempEnv(); git(t.project, "clone", "--local", t.project, other.project);
  const calls = join(other.home, "calls.jsonl");
  const r = await run(["install"], {cwd: other.project, env: {...other.env, FAKE_SKILLS_LOG: calls}}); expect(r.code, r.stderr).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse)).toEqual([["experimental_install", "--frozen-lockfile"]]);
  expect(readFileSync(join(other.project, "skills-lock.json"), "utf8")).toBe(readFileSync(join(t.project, "skills-lock.json"), "utf8"));
  expect(existsSync(join(other.project, ".claude/skills/review/SKILL.md"))).toBe(true);
  expect(existsSync(join(other.project, ".codex/config.toml"))).toBe(true);
  expect(readFileSync(join(other.project, "loadouts.lock.json"), "utf8")).toBe(readFileSync(join(t.project, "loadouts.lock.json"), "utf8"));
});
test("install repairs a missing or broken Claude skill link while retaining the shared skill", async () => {
  const t = setup(); await run(["install"], t.opts);
  const before = readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8");
  rmSync(join(t.project, ".claude/skills/review"), {recursive: true, force: true});
  mkdirSync(join(t.project, ".claude/skills"), {recursive: true}); symlinkSync("/missing-fixture-skill", join(t.project, ".claude/skills/review"));
  expect((await run(["install"], t.opts)).code).toBe(0);
  expect(readFileSync(join(t.project, ".claude/skills/review/SKILL.md"), "utf8")).toContain("review");
  expect(readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8")).toBe(before);
});

test("frozen restore rejects changed upstream contents without replacing the lock or falling back to add", async () => {
  const t = setup(); await run(["install"], t.opts);
  const file = join(t.project, "skills-lock.json"), before = readFileSync(file, "utf8");
  rmSync(join(t.project, ".agents/skills"), {recursive: true}); writeFileSync(t.opts.env.FAKE_SKILLS_LOG, "");
  const r = await run(["install"], {...t.opts, env: {...t.opts.env, FAKE_SKILLS_CONTENT: "changed"}});
  expect(r.code).toBe(1); expect(r.stderr).toContain("frozen"); expect(r.stderr).toContain("loadouts update");
  expect(readFileSync(file, "utf8")).toBe(before); expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
  expect(t.lock().incomplete).toBe(true);
  expect(readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8")).not.toContain('"add"');
  expect((await run(["install"], t.opts)).code).toBe(0);
});

test("update explicitly accepts new skill contents once across harnesses", async () => {
  const t = setup(); await run(["install"], t.opts);
  const file = join(t.project, "skills-lock.json"), before = readFileSync(file, "utf8");
  const env = {...t.opts.env, FAKE_SKILLS_CONTENT: "updated"};
  expect((await run(["install"], {...t.opts, env})).code).toBe(0); expect(readFileSync(file, "utf8")).toBe(before);
  writeFileSync(t.opts.env.FAKE_SKILLS_LOG, "");
  const r = await run(["update"], {...t.opts, env}); expect(r.code, r.stderr).toBe(0);
  expect(readFileSync(file, "utf8")).not.toBe(before);
  expect(readFileSync(join(t.project, ".claude/skills/review/SKILL.md"), "utf8")).toContain("updated");
  expect(readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8").trim().split("\n")).toHaveLength(1);
});

test("restore selects only wanted lock entries and diagnoses a successful installer that omitted a skill", async () => {
  const t = setup(); await run(["install"], t.opts);
  const file = join(t.project, "skills-lock.json"), lock = JSON.parse(readFileSync(file, "utf8"));
  lock.skills.unrelated = {...lock.skills.review, source: "other/repo"}; writeFileSync(file, JSON.stringify(lock));
  const before = readFileSync(file, "utf8"); rmSync(join(t.project, ".agents/skills"), {recursive: true});
  const bad = await run(["install"], {...t.opts, env: {...t.opts.env, FAKE_SKILLS_RESTORE_SKIP: "review"}});
  expect(bad.code).toBe(1); expect(readFileSync(file, "utf8")).toBe(before);
  const good = await run(["install"], t.opts); expect(good.code, good.stderr).toBe(0);
  expect(existsSync(join(t.project, ".agents/skills/unrelated"))).toBe(false); expect(readFileSync(file, "utf8")).toBe(before);
});

test("missing native lock requires explicit update when owned skill contents are absent", async () => {
  const t = setup(); await run(["install"], t.opts);
  rmSync(join(t.project, ".agents/skills"), {recursive: true}); rmSync(join(t.project, "skills-lock.json"));
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("skills-lock.json");
  expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
  expect((await run(["update"], t.opts)).code).toBe(0);
});

test("adding a harness reuses locked files without accepting newer contents", async () => {
  const t = setup(); t.save({...t.manifest, harnesses: ["codex"]}); await run(["install"], t.opts);
  const file = join(t.project, "skills-lock.json"), before = readFileSync(file, "utf8");
  const r = await run(["harness", "add", "claude-code"], {...t.opts, env: {...t.opts.env, FAKE_SKILLS_CONTENT: "changed"}});
  expect(r.code, r.stderr).toBe(0); expect(readFileSync(file, "utf8")).toBe(before);
  expect(readFileSync(join(t.project, ".claude/skills/review/SKILL.md"), "utf8")).toBe("# review\n");
});

test("partial repository retry cannot change the hash of a previously successful skill", async () => {
  const t = setup(); writeFileSync(t.file, "name: work\nitems: {tools: {skills: [acme/tools]}}\n");
  const env = {...t.opts.env, FAKE_SKILLS: JSON.stringify({"acme/tools": ["one", "two"]})};
  expect((await run(["install"], {...t.opts, env: {...env, FAKE_SKILLS_PARTIAL: "acme/tools"}})).code).toBe(1);
  const file = join(t.project, "skills-lock.json"), before = readFileSync(file, "utf8");
  expect((await run(["install"], {...t.opts, env: {...env, FAKE_SKILLS_CONTENT: "changed"}})).code).toBe(1);
  expect(readFileSync(file, "utf8")).toBe(before); expect(readFileSync(join(t.project, ".agents/skills/one/SKILL.md"), "utf8")).toBe("# one\n");
  expect((await run(["install"], {...t.opts, env})).code).toBe(0);
  expect(t.lock().installed["skill:codex:acme/tools"]).toEqual(["one", "two"]);
});

test("conflicting sources and malformed native locks fail without overwriting installed files", async () => {
  const t = setup(); await run(["install"], t.opts);
  const file = join(t.project, "skills-lock.json"), lock = JSON.parse(readFileSync(file, "utf8"));
  rmSync(join(t.project, ".agents/skills"), {recursive: true});
  for (const data of [{version: 9, skills: {}}, {...lock, skills: {"../escape": lock.skills.review}}, {...lock, skills: {review: {...lock.skills.review, source: "other/repo"}}}]) {
    const before = JSON.stringify(data); writeFileSync(file, before);
    const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
  }
});

test("new skills preserve conflicting local folders and report link conflicts without losing recovery ownership", async () => {
  const t = setup(), dir = join(t.project, ".agents/skills/review");
  mkdirSync(dir, {recursive: true}); writeFileSync(join(dir, "SKILL.md"), "local instructions");
  const first = await run(["install"], t.opts); expect(first.code).toBe(1);
  expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe("local instructions");
  rmSync(dir, {recursive: true});
  const link = join(t.project, ".claude/skills/review"); mkdirSync(link, {recursive: true}); writeFileSync(join(link, "SKILL.md"), "manual copy");
  const second = await run(["install"], t.opts); expect(second.code).toBe(1);
  expect(readFileSync(join(link, "SKILL.md"), "utf8")).toBe("manual copy");
  expect(t.lock().installed["skill:claude-code:acme/tools@review"]).toEqual(["review"]);
  rmSync(link, {recursive: true}); expect((await run(["install"], t.opts)).code).toBe(0);
});

test("removing one harness after frozen restoration retains skills needed by the other", async () => {
  for (const harness of ["claude-code", "codex"]) {
    const t = setup(); await run(["install"], t.opts);
    rmSync(join(t.project, ".agents/skills"), {recursive: true}); expect((await run(["install"], t.opts)).code).toBe(0);
    const r = await run(["harness", "remove", harness], t.opts); expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(t.project, ".agents/skills/review/SKILL.md"))).toBe(true);
    if (harness === "codex") expect(existsSync(join(t.project, ".claude/skills/review/SKILL.md"))).toBe(true);
    else expect(existsSync(join(t.project, ".claude/skills/review"))).toBe(false);
    expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBeUndefined();
  }
});

test("repository update shares newly discovered names with both harnesses in either order", async () => {
  const t = setup(); t.save({...t.manifest, harnesses: ["codex", "claude-code"]});
  writeFileSync(t.file, "name: work\nitems: {tools: {skills: [acme/tools]}}\n");
  expect((await run(["install"], {...t.opts, env: {...t.opts.env, FAKE_SKILLS: '{"acme/tools":["one"]}'}})).code).toBe(0);
  const r = await run(["update"], {...t.opts, env: {...t.opts.env, FAKE_SKILLS: '{"acme/tools":["one","two"]}'}}); expect(r.code, r.stderr).toBe(0);
  expect(existsSync(join(t.project, ".claude/skills/two/SKILL.md"))).toBe(true);
  expect(t.lock().installed["skill:claude-code:acme/tools"]).toEqual(["one", "two"]);
});

test("installation refuses symlinked skill parent directories before writing outside the project", async () => {
  for (const parent of [".agents", ".claude"]) {
    const t = setup(), outside = join(t.home, "outside"); mkdirSync(outside);
    symlinkSync(outside, join(t.project, parent));
    const r = await run(["install"], t.opts); expect(r.code).toBe(1);
    expect(existsSync(join(outside, "skills"))).toBe(false);
  }
});

test("partial update remains pending until all changed contents are explicitly accepted", async () => {
  const t = setup(); writeFileSync(t.file, "name: work\nitems: {tools: {skills: [acme/tools]}}\n");
  const env = {...t.opts.env, FAKE_SKILLS: '{"acme/tools":["one","two"]}'};
  expect((await run(["install"], {...t.opts, env})).code).toBe(0);
  const changed = {...env, FAKE_SKILLS_CONTENT: "changed"};
  expect((await run(["update"], {...t.opts, env: {...changed, FAKE_SKILLS_PARTIAL: "acme/tools"}})).code).toBe(1);
  expect(t.lock().pending).toContain("skill:claude-code:acme/tools");
  const retry = await run(["install"], {...t.opts, env: changed}); expect(retry.code).toBe(1); expect(retry.stderr).toContain("loadouts update");
  expect(t.lock().incomplete).toBe(true);
  expect(readFileSync(join(t.project, ".agents/skills/two/SKILL.md"), "utf8")).toBe("# two\n");
  expect((await run(["update"], {...t.opts, env: changed})).code).toBe(0); expect(t.lock().pending).toBeUndefined();
  expect(readFileSync(join(t.project, ".claude/skills/two/SKILL.md"), "utf8")).toContain("changed");
});

test("resolved link conflicts and failed restores retry without falling back to discovery", async () => {
  for (const mode of ["link", "restore"]) {
    const t = setup(); t.save({...t.manifest, harnesses: ["codex"]}); expect((await run(["install"], t.opts)).code).toBe(0);
    const link = join(t.project, ".claude/skills/review");
    if (mode === "link") { mkdirSync(link, {recursive: true}); writeFileSync(join(link, "SKILL.md"), "manual"); }
    else rmSync(join(t.project, ".agents/skills"), {recursive: true});
    const failed = await run(["harness", "add", "claude-code"], {...t.opts, env: {...t.opts.env, FAKE_SKILLS_RESTORE_FAIL: "1"}}); expect(failed.code).toBe(1);
    if (mode === "link") rmSync(link, {recursive: true});
    writeFileSync(t.opts.env.FAKE_SKILLS_LOG, "");
    const retry = await run(["install"], {...t.opts, env: {...t.opts.env, ...(mode === "link" ? {FAKE_SKILLS_CONTENT: "changed"} : {})}});
    expect(retry.code, retry.stderr).toBe(0);
    expect(readFileSync(t.opts.env.FAKE_SKILLS_LOG, "utf8")).not.toContain('"add"');
    expect(readFileSync(join(link, "SKILL.md"), "utf8")).toBe("# review\n");
  }
});
test("install applies selected local edits, leaves other drafts inactive and removes missing selected files", async () => {
  const t = setup(); await run(["install"], t.opts);
  writeFileSync(t.file, readFileSync(t.file, "utf8").replace("original", "edited"));
  writeFileSync(join(t.project, ".loadouts/catalog/unselected.yml"), "name: unselected\nitems: {}\nconventions: never apply\n");
  expect((await run(["install"], t.opts)).code).toBe(0); expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("edited");
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).not.toContain("never apply");
  rmSync(t.file); t.save({...t.manifest, loadouts: {}});
  expect((await run(["install"], t.opts)).code).toBe(0); expect(t.lock().installed).toEqual({});
  expect(existsSync(join(t.project, ".agents/skills/review"))).toBe(false);
});
test("first install preflight failure preserves manifest and leaves no lock or settings", async () => {
  const t = setup(false); writeFileSync(t.file, 'name: work\nitems: {server: {mcp: {bad: {command: "false"}}}}\n');
  const before = readFileSync(join(t.project, "loadouts.json"), "utf8");
  const r = await run(["install"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("not reachable");
  expect(existsSync(join(t.project, "loadouts.lock.json"))).toBe(false); expect(existsSync(join(t.project, ".mcp.json"))).toBe(false);
  expect(readFileSync(join(t.project, "loadouts.json"), "utf8")).toBe(before);
});
test("partial first install records intended manifest and supports retry and removal", async () => {
  const t = setup(); writeFileSync(t.file, "name: work\nitems: {tools: {skills: [acme/tools]}}\n");
  const env = {...t.opts.env, FAKE_SKILLS: JSON.stringify({"acme/tools": ["one", "two"]}), FAKE_SKILLS_PARTIAL: "acme/tools"};
  expect((await run(["install"], {...t.opts, env})).code).toBe(1);
  expect(t.lock().pending).toEqual(["skill:claude-code:acme/tools"]); expect(t.lock().installed["skill:claude-code:acme/tools"]).toEqual(["one"]);
  expect((await run(["install"], {...t.opts, env: {...env, FAKE_SKILLS_PARTIAL: ""}})).code).toBe(0);
  expect(t.lock().pending).toBeUndefined();
  rmSync(t.file); expect((await run(["remove", "work"], t.opts)).code).toBe(0); expect(t.lock().installed).toEqual({});
});
test("migration preserves applied selections and edited and unselected drafts without changing Codex home", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env}, catalog = fixtureCatalog();
  mkdirSync(join(t.project, ".loadouts/codex-home"), {recursive: true}); writeFileSync(join(t.project, ".loadouts/codex-home/state"), "keep");
  const applied = "name: work\nitems: {}\nconventions: applied\n", edited = applied.replace("applied", "edited");
  writeFileSync(join(t.project, ".loadouts/work.yml"), edited); writeFileSync(join(t.project, ".loadouts/draft.yml"), "name: draft\nitems: {}\n");
  const old = {version: 2, harnesses: ["claude-code"], catalog: {repo: catalog, ref: "v1.0.0", commit: git(catalog, "rev-parse", "HEAD")}, loadouts: {work: {}, backend: {runtime: ["python"]}}, local: {work: applied}, installed: {}, incomplete: true};
  writeFileSync(join(t.project, "loadouts.lock.json"), JSON.stringify(old));
  expect((await run(["init"], opts)).code).toBe(0);
  const manifest = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")), lock = JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8"));
  expect(manifest.harnesses).toEqual(["claude-code"]); expect(manifest.loadouts.work.source).toBe("file:./.loadouts/catalog/work.yml");
  expect(manifest.loadouts.work.choices).toBeUndefined();
  expect(manifest.loadouts.backend.choices).toEqual({runtime: ["python"]}); expect(lock.local.work).toBe(applied); expect(lock.incomplete).toBe(true);
  expect(lock.resolved.backend.catalog.commit).toBe(old.catalog.commit); expect(manifest.loadouts.backend.source).not.toContain("@v1.0.0");
  expect(readFileSync(join(t.project, ".loadouts/catalog/work.yml"), "utf8")).toBe(edited);
  expect(existsSync(join(t.project, ".loadouts/catalog/draft.yml"))).toBe(true); expect(manifest.loadouts.draft).toBeUndefined();
  expect(existsSync(join(t.project, ".loadouts/work.yml"))).toBe(false); expect(readFileSync(join(t.project, ".loadouts/codex-home/state"), "utf8")).toBe("keep");
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8"); expect((await run(["init"], opts)).code).toBe(0); expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
});
test("migration refuses conflicting destinations before moving any files", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env}; mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true});
  for (const name of ["a", "z"]) writeFileSync(join(t.project, `.loadouts/${name}.yml`), `name: ${name}\nitems: {}\n`);
  writeFileSync(join(t.project, ".loadouts/catalog/z.yml"), "different");
  const before = JSON.stringify({version: 1, harnesses: ["codex"], catalog: null, loadouts: {}, installed: {}}); writeFileSync(join(t.project, "loadouts.lock.json"), before);
  expect((await run(["init"], opts)).code).toBe(1); expect(existsSync(join(t.project, ".loadouts/a.yml"))).toBe(true);
  expect(readFileSync(join(t.project, ".loadouts/catalog/z.yml"), "utf8")).toBe("different"); expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before); expect(existsSync(join(t.project, "loadouts.json"))).toBe(false);
});
test("bare add uses shared catalog explicitly, local selection requires file source", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env}; await run(["init", "--harness", "claude-code"], opts);
  mkdirSync(join(t.project, ".loadouts/catalog"), {recursive: true}); writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {}\nconventions: local only\n");
  expect((await run(["add", "backend", "--catalog", catalog], opts)).code).toBe(0); expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).not.toContain("local only");
  expect((await run(["add", "file:./.loadouts/catalog/backend.yml", "--yes"], opts)).code).toBe(0); expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("local only");
});


test("manifest-only diagnostics find the project from nested directories without applying it", async () => {
  const t = setup(false), nested = join(t.project, "src"); mkdirSync(nested);
  await run(["setup", "--catalog", fixtureCatalog(), "--harness", "claude-code"], t.opts);
  const opts = {...t.opts, cwd: nested}, before = readFileSync(join(t.project, "loadouts.json"), "utf8");
  const status = await run(["status", "--json"], opts); expect(status.code).toBe(0); expect(JSON.parse(status.stdout).needsInstall).toBe(true);
  const inspection = JSON.parse((await run(["inspect", "--json"], opts)).stdout);
  expect(inspection.project).toBe(t.project); expect(inspection.initialized).toBe(true); expect(inspection.manifests).toContain(join(t.project, "loadouts.json"));
  const diagnosis = await run(["doctor", "--json"], opts); expect(diagnosis.code).toBe(1);
  expect(JSON.parse(diagnosis.stdout).findings).toContainEqual(expect.objectContaining({fix: "loadouts install"}));
  expect(existsSync(join(t.project, "loadouts.lock.json"))).toBe(false); expect(readFileSync(join(t.project, "loadouts.json"), "utf8")).toBe(before);
});
test("status and doctor explain manifest drift while retaining the applied setup", async () => {
  const t = setup(false); await run(["setup", "--catalog", fixtureCatalog(), "--harness", "claude-code"], t.opts);
  await run(["install"], t.opts); const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  t.save({...t.manifest, harnesses: ["claude-code"]});
  expect(JSON.parse((await run(["status", "--json"], t.opts)).stdout).needsInstall).toBe(true);
  const r = await run(["doctor", "--json"], t.opts); expect(r.code).toBe(1);
  expect(JSON.parse(r.stdout).findings).toContainEqual(expect.objectContaining({message: expect.stringContaining("loadouts.json"), fix: "loadouts install"}));
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
});
test("show follows an uninstalled explicit shared source despite a same-name draft", async () => {
  const t = setup(false), catalog = fixtureCatalog();
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {}\nconventions: local draft\n");
  t.save({harnesses: ["claude-code"], loadouts: {backend: {source: `file:${catalog}#backend`}}});
  const r = await run(["show", "backend", "--json"], t.opts); expect(r.code).toBe(0);
  expect(JSON.parse(r.stdout).source.kind).toBe("catalog"); expect(JSON.parse(r.stdout).items.runtime).toBeDefined();
  expect(existsSync(join(t.project, "loadouts.lock.json"))).toBe(false);
});
test("malformed existing locks are never replaced by install", async () => {
  const t = setup(false), path = join(t.project, "loadouts.lock.json"), before = '{"version":3,"resolved":{}}';
  writeFileSync(path, before); expect((await run(["install"], t.opts)).code).toBe(1); expect(readFileSync(path, "utf8")).toBe(before);
});

test.each(["codex", "invalid"])("rejected legacy init --harness %s preserves all project files", async harness => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env}; mkdirSync(join(t.project, ".loadouts"));
  const yaml = "name: work\nitems: {}\n", before = JSON.stringify({version: 2, harnesses: ["claude-code"], catalog: null, loadouts: {work: {}}, local: {work: yaml}, installed: {}});
  writeFileSync(join(t.project, ".loadouts/work.yml"), yaml); writeFileSync(join(t.project, "loadouts.lock.json"), before);
  expect((await run(["init", "--harness", harness], opts)).code).toBe(2);
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
  expect(readFileSync(join(t.project, ".loadouts/work.yml"), "utf8")).toBe(yaml);
  expect(existsSync(join(t.project, "loadouts.json"))).toBe(false); expect(existsSync(join(t.project, ".loadouts/catalog"))).toBe(false);
});

test("removal and source replacement work when the previous catalog is unavailable", async () => {
  for (const action of ["remove", "replace"]) {
    const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
    await run(["init", "--harness", "claude-code"], opts);
    expect((await run(["add", "backend", "--catalog", catalog], opts)).code).toBe(0);
    rmSync(catalog, {recursive: true}); rmSync(t.env.LOADOUTS_CACHE!, {recursive: true});
    if (action === "replace") writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {}\nconventions: replacement\n");
    const r = await run(action === "remove" ? ["remove", "backend"] : ["add", "file:./.loadouts/catalog/backend.yml", "--yes"], opts);
    expect(r.code, r.stderr).toBe(0);
    expect(existsSync(join(t.project, ".agents/skills/bun-skills"))).toBe(false);
    const lock = JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")); expect(lock.installed).toEqual({});
    expect(Object.keys(lock.loadouts)).toEqual(action === "remove" ? [] : ["backend"]);
  }
});
test("unavailable historical MCP definitions cause conservative preflight before switching source", async () => {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  await run(["init", "--harness", "claude-code"], opts);
  expect((await run(["add", "frontend", "--catalog", catalog], opts)).code).toBe(0);
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  rmSync(catalog, {recursive: true}); rmSync(t.env.LOADOUTS_CACHE!, {recursive: true});
  const file = join(t.project, ".loadouts/catalog/frontend.yml"); writeFileSync(file, 'name: frontend\nitems: {ui: {mcp: {shadcn: {command: "false"}}}}\n');
  const failed = await run(["add", "file:./.loadouts/catalog/frontend.yml", "--yes"], opts); expect(failed.code).toBe(1); expect(failed.stderr).toContain("not reachable");
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
  writeFileSync(file, `name: frontend\nitems: {ui: {mcp: {shadcn: {command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(join(import.meta.dir, "fixtures/mcp-ok.ts"))}]}}}}\n`);
  const r = await run(["add", "file:./.loadouts/catalog/frontend.yml", "--yes"], opts); expect(r.code, r.stderr).toBe(0);
});

test.each([".agents/skills", ".claude/skills", ".claude/settings.json", ".mcp.json", "AGENTS.md"])("missing %s requires installation across status, doctor, launch and publication", async missing => {
  const t = setup(), bin = join(t.home, "bin"); mkdirSync(bin);
  writeFileSync(join(bin, "claude"), '#!/bin/sh\nexit 9\n', {mode: 0o755});
  const opts = {...t.opts, env: {...t.opts.env, PATH: `${bin}:${process.env.PATH}`}};
  t.save({...t.manifest, harnesses: ["claude-code"]});
  writeFileSync(t.file, `name: work\nitems:\n  tool:\n    skills: [acme/tools@review]\n    claude: {plugin: review@team, marketplace: acme/team}\n    mcp:\n      ok: {command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(join(import.meta.dir, "fixtures/mcp-ok.ts"))}]}\n`);
  await run(["setup", "--catalog", fixtureCatalog(), "--harness", "claude-code"], opts);
  expect((await run(["install"], opts)).code).toBe(0);
  const before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  rmSync(join(t.project, missing), {recursive: true});
  expect(JSON.parse((await run(["status", "--json"], opts)).stdout).needsInstall).toBe(true);
  const diagnosis = await run(["doctor", "--json"], opts); expect(diagnosis.code).toBe(1);
  expect(JSON.parse(diagnosis.stdout).findings).toContainEqual(expect.objectContaining({message: expect.stringContaining("missing"), fix: "loadouts install"}));
  expect((await run(["claude"], opts)).stderr).toContain("loadouts install");
  expect((await run(["publish", "work", "--summary", "Verified previously", "--catalog", "acme/catalog"], opts)).stderr).toContain("loadouts install");
  expect(existsSync(join(t.project, missing))).toBe(false); expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
  expect((await run(["install"], opts)).code).toBe(0);
  expect(JSON.parse((await run(["status", "--json"], opts)).stdout).needsInstall).toBeUndefined();
  expect((await run(["claude"], opts)).code).toBe(9);
});
