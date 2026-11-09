import { test, expect } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tempEnv, fixtureCatalog, git, repo, run } from "./helpers";

async function setup() {
  const t = tempEnv(), catalog = fixtureCatalog(), remote = join(t.home, "upstream.git"), fork = join(t.home, "fork.git"), bin = join(t.home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!${process.execPath}\nawait import(${JSON.stringify(join(repo, "tests/fixtures/fake-gh.ts"))});\n`, {mode: 0o755});
  git(catalog, "clone", "--bare", catalog, remote); git(catalog, "clone", "--bare", catalog, fork);
  const log = join(t.home, "gh.log"), env = {...t.env, PATH: `${bin}:${process.env.PATH}`, FAKE_GH_LOG: log, FAKE_GH_REMOTE: remote, FAKE_GH_FORK: fork,
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid"};
  const opts = {cwd: t.project, env};
  await run(["setup", "--catalog", catalog, "--harness", "claude-code"], opts);
  await run(["init"], opts); await run(["create", "pipeline"], opts);
  writeFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "name: pipeline\nitems: {runtime: {skills: [acme/bun-skills]}}\nconventions: Verified project setup.\n");
  expect((await run(["add", "file:./.loadouts/catalog/pipeline.yml"], opts)).code).toBe(0);
  writeFileSync(join(t.project, "private-notes.txt"), "Do not publish this.");
  const args = ["publish", "pipeline", "--catalog", "acme/catalog", "--summary", "Verified with the project's test suite."];
  const events = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
  return {...t, opts, args, events, remote, fork, catalog};
}

async function composition(t: Awaited<ReturnType<typeof setup>>, includes: object) {
  writeFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), JSON.stringify({name: "pipeline", includes}));
  return run(["install"], t.opts);
}

function sharedCatalog(t: Awaited<ReturnType<typeof setup>>) {
  Object.assign(t.opts.env, {GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${t.remote}.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/acme/catalog.git"});
}

function captureGit(t: Awaited<ReturnType<typeof setup>>) {
  const log = join(t.home, "git.log"), executable = Bun.which("git")!;
  writeFileSync(join(t.home, "bin/git"), `#!${process.execPath}\nimport {appendFileSync, writeSync} from "node:fs";\nconst args=process.argv.slice(2); appendFileSync(${JSON.stringify(log)},JSON.stringify({args,offline:process.env.GIT_NO_LAZY_FETCH})+"\\n");\nconst child=Bun.spawnSync([${JSON.stringify(executable)},...args],{stdout:"pipe",stderr:"pipe"});writeSync(1,child.stdout);writeSync(2,child.stderr);process.exit(child.exitCode);\n`, {mode: 0o755});
  return () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
}

test.each(["file:./.loadouts/catalog/missing.yml", "absolute"])("publication rejects dormant nonportable member sources without fetching: %s", async source => {
  const t = await setup(), declaration = source === "absolute" ? `file:${t.catalog}#missing@v1.0.0` : source;
  writeFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), JSON.stringify({name: "pipeline", items: {branch: {one_of: {
    selected: {}, dormant: {includes: {missing: {source: declaration}}},
  }, default: "selected"}}}));
  expect((await run(["install"], t.opts)).code).toBe(0);
  const calls = captureGit(t), result = await run(t.args, t.opts);
  expect(result.code).toBe(1); expect(result.stderr).toContain("items.branch.one_of.dormant.includes.missing"); expect(result.stderr).toContain("github:");
  expect(calls().some(event => event.args.includes("fetch") || event.args.includes("clone"))).toBe(false); expect(t.events()).toEqual([]);
});

test("publication inspects dormant sources in active pinned definitions without opening inactive targets", async () => {
  const t = await setup(); sharedCatalog(t);
  const seed = join(t.home, "dormant-seed"); git(t.project, "clone", t.remote, seed);
  writeFileSync(join(seed, "loadouts/middle.yml"), JSON.stringify({name: "middle", items: {branch: {one_of: {
    selected: {}, dormant: {includes: {missing: {source: `file:${t.catalog}#missing@v1.0.0`}}},
  }, default: "selected"}}}));
  git(seed, "add", "."); git(seed, "commit", "-m", "Dormant absolute include"); git(seed, "push", "origin", "main");
  expect((await composition(t, {middle: {source: "github:acme/catalog/middle@main"}})).code).toBe(0);
  const calls = captureGit(t), result = await run(t.args, t.opts);
  expect(result.code).toBe(1); expect(result.stderr).toContain("pipeline → middle"); expect(result.stderr).toContain("items.branch.one_of.dormant.includes.missing");
  expect(calls().some(event => event.args.includes("fetch") || event.args.includes("clone"))).toBe(false); expect(t.events()).toEqual([]);
});

test("publication states active verification scope and preserves dormant portable YAML", async () => {
  const t = await setup(); sharedCatalog(t);
  const yaml = '# Preserve this comment\nname: pipeline\nitems:\n  branch:\n    one_of:\n      selected: {}\n      dormant:\n        includes:\n          missing: {source: github:acme/catalog/missing@v1.0.0}\n    default: selected\n';
  writeFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), yaml);
  expect((await run(["install"], t.opts)).code).toBe(0);
  const calls = captureGit(t), preview = await run(t.args, t.opts);
  expect(preview.code, preview.stderr).toBe(0); expect(preview.stdout).toContain(yaml);
  expect(preview.stdout).toContain("Verified active choices"); expect(preview.stdout).toContain('"pipeline":{"branch":["selected"]}');
  expect(preview.stdout).toContain("Inactive targets were checked for source portability only"); expect(preview.stdout).toContain("not fetched or tested");
  expect(calls().some(event => event.args.includes("fetch") || event.args.includes("clone"))).toBe(false);
  const result = await run([...t.args, "--yes"], t.opts); expect(result.code, result.stderr).toBe(0);
  const pr = t.events().find(event => event.args[0] === "pr"); expect(pr.body).toContain("Verified active choices"); expect(pr.body).toContain("not fetched or tested");
  const head = pr.args[pr.args.indexOf("--head") + 1];
  const published = Bun.spawnSync(["git", "show", `${head}:loadouts/pipeline.yml`], {cwd: t.remote, env: {...process.env, HOME: t.home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1"}, stdout: "pipe", stderr: "pipe"});
  expect(published.exitCode).toBe(0); expect(published.stdout.toString()).toBe(yaml);
});

test("portable composition previews offline and publishes only its unchanged YAML", async () => {
  const t = await setup(); sharedCatalog(t);
  expect((await composition(t, {backend: {source: "github:acme/catalog/backend@v1.0.0", choices: {runtime: ["python"]}}})).code).toBe(0);
  const yaml = readFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "utf8");
  const preview = await run(t.args, t.opts);
  expect(preview.code).toBe(0); expect(preview.stdout).toContain(yaml); expect(t.events()).toEqual([]);
  expect(preview.stdout).toContain('"backend":{"runtime":["python"]}');
  const result = await run([...t.args, "--yes"], t.opts);
  expect(result.code).toBe(0);
  const pr = t.events().find(e => e.args[0] === "pr");
  expect(pr.files).toEqual(["loadouts/pipeline.yml"]);
  expect(pr.body).toContain('"backend":{"runtime":["python"]}');
  const head = pr.args[pr.args.indexOf("--head") + 1];
  expect(git(t.remote, "show", `${head}:loadouts/pipeline.yml`)).toBe(yaml);
});

test.each([false, true])("publication rejects consumer-local dependencies with their path (transitive=%s)", async transitive => {
  const t = await setup();
  writeFileSync(join(t.project, ".loadouts/catalog/leaf.yml"), "name: leaf\nitems: {}\n");
  const leaf = {leaf: {source: "file:./.loadouts/catalog/leaf.yml"}};
  writeFileSync(join(t.project, ".loadouts/catalog/middle.yml"), JSON.stringify({name: "middle", includes: leaf}));
  expect((await composition(t, transitive ? {middle: {source: "file:./.loadouts/catalog/middle.yml"}} : leaf)).code).toBe(0);
  const result = await run([...t.args, "--yes"], t.opts);
  expect(result.code).toBe(1); expect(result.stderr).toContain(transitive ? "pipeline → middle → leaf" : "pipeline → leaf");
  expect(result.stderr).toContain("github:"); expect(t.events()).toEqual([]);
});

test.each([false, true])("publication rejects absolute Git dependencies with their path (transitive=%s)", async transitive => {
  const t = await setup(); sharedCatalog(t);
  if (transitive) {
    const seed = join(t.home, "composition-seed"); git(t.project, "clone", t.remote, seed);
    writeFileSync(join(seed, "loadouts/middle.yml"), JSON.stringify({name: "middle", includes: {backend: {source: `file:${t.catalog}#backend@v1.0.0`}}}));
    git(seed, "add", "."); git(seed, "commit", "-m", "Shared composition"); git(seed, "push", "origin", "main");
  }
  expect((await composition(t, transitive ? {middle: {source: "github:acme/catalog/middle@main"}} : {backend: {source: `file:${t.catalog}#backend@v1.0.0`}})).code).toBe(0);
  const result = await run([...t.args, "--yes"], t.opts);
  expect(result.code).toBe(1); expect(result.stderr).toContain(transitive ? "pipeline → middle → backend" : "pipeline → backend");
  expect(t.events()).toEqual([]);
});

test("an included-only local leaf publishes first, then its parent uses the available shared source", async () => {
  const t = await setup(); sharedCatalog(t);
  const file = join(t.project, ".loadouts/catalog/leaf.yml"); writeFileSync(file, "name: leaf\nitems: {}\n");
  expect((await composition(t, {leaf: {source: "file:./.loadouts/catalog/leaf.yml"}})).code).toBe(0);
  const leafArgs = t.args.map(arg => arg === "pipeline" ? "leaf" : arg);
  expect((await run(leafArgs, t.opts)).code).toBe(0); expect(t.events()).toEqual([]);
  expect((await run([...t.args, "--yes"], t.opts)).code).toBe(1); expect(t.events()).toEqual([]);
  expect((await run([...leafArgs, "--yes"], t.opts)).code).toBe(0);
  const pr = t.events().find(e => e.args[0] === "pr"); expect(pr.files).toEqual(["loadouts/leaf.yml"]);
  const head = pr.args[pr.args.indexOf("--head") + 1], seed = join(t.home, "merge-leaf");
  git(t.project, "clone", t.remote, seed); git(seed, "merge", "--ff-only", `origin/${head}`); git(seed, "push", "origin", "main");
  writeFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "name: pipeline\nincludes:\n  leaf: {source: github:acme/catalog/leaf@main}\n");
  expect((await run(t.args, t.opts)).code).toBe(1);
  expect((await run(["install"], t.opts)).code).toBe(0);
  expect((await run([...t.args, "--yes"], t.opts)).code).toBe(0);
  const parent = t.events().filter(e => e.args[0] === "pr").at(-1);
  expect(parent.files).toEqual(["loadouts/pipeline.yml"]);
});

test("publication refuses stale included local snapshots before GitHub calls", async () => {
  const t = await setup(), file = join(t.project, ".loadouts/catalog/leaf.yml");
  writeFileSync(file, "name: leaf\nitems: {}\n");
  expect((await composition(t, {leaf: {source: "file:./.loadouts/catalog/leaf.yml"}})).code).toBe(0);
  writeFileSync(file, "name: leaf\nitems: {}\n# pending edit\n");
  const result = await run([...t.args, "--yes"], t.opts);
  expect(result.code).toBe(1); expect(result.stderr).toContain("current contents"); expect(result.stderr).toContain("pipeline → leaf");
  expect(t.events()).toEqual([]);
});

test.each(["missing file", "missing ownership", "pending"])("publication checks descendant artifacts: %s", async damage => {
  const t = await setup(); sharedCatalog(t);
  expect((await composition(t, {backend: {source: "github:acme/catalog/backend@v1.0.0", choices: {runtime: ["python"]}}})).code).toBe(0);
  const file = join(t.project, "loadouts.lock.json"), lock = JSON.parse(readFileSync(file, "utf8")), key = "skill:claude-code:acme/py-skills";
  if (damage === "missing file") rmSync(join(t.project, ".agents/skills", lock.installed[key][0]), {recursive: true, force: true});
  else {
    if (damage === "missing ownership") delete lock.installed[key];
    else lock.pending = [key];
    writeFileSync(file, JSON.stringify(lock));
  }
  const commands = captureGit(t);
  const result = await run([...t.args, "--yes"], t.opts);
  expect(result.code).toBe(1); expect(result.stderr).toMatch(/artifacts|incomplete/); expect(t.events()).toEqual([]);
  expect(commands().some(event => event.args.includes("fetch") || event.args.includes("clone"))).toBe(false);
});

test.each([false, true])("publication reads only cached descendant definitions (cache missing=%s)", async missing => {
  const t = await setup(); sharedCatalog(t);
  expect((await composition(t, {backend: {source: "github:acme/catalog/backend@v1.0.0"}})).code).toBe(0);
  if (missing) rmSync(t.env.LOADOUTS_CACHE, {recursive: true, force: true});
  rmSync(t.remote, {recursive: true, force: true});
  const commands = captureGit(t);
  const result = await run(t.args, t.opts);
  if (!missing) expect(result.stderr).toBe("");
  expect(result.code).toBe(missing ? 1 : 0);
  if (missing) expect(result.stderr).toContain("cache");
  expect(commands().some(event => event.args.includes("fetch") || event.args.includes("clone"))).toBe(false);
  expect(commands().every(event => event.offline === "1")).toBe(true);
  expect(t.events()).toEqual([]);
});

test("publication previews exact YAML and notes without touching GitHub or project state", async () => {
  const t = await setup(), file = join(t.project, "loadouts.lock.json"), before = readFileSync(file, "utf8");
  const r = await run(t.args, t.opts);
  expect(r.code).toBe(0); expect(r.stdout).toContain("acme/catalog"); expect(r.stdout).toContain("Verified with the project's test suite.");
  expect(r.stdout).toContain(readFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "utf8"));
  expect(r.stdout).toContain("--yes"); expect(t.events()).toEqual([]);
  expect(readFileSync(file, "utf8")).toBe(before);
});

test("publication refuses unapplied, edited and incomplete local definitions", async () => {
  const t = await setup(), file = join(t.project, ".loadouts/catalog/pipeline.yml"), original = readFileSync(file, "utf8");
  writeFileSync(file, original + "# edited\n");
  expect((await run(t.args, t.opts)).code).toBe(1);
  writeFileSync(file, original);
  const lockFile = join(t.project, "loadouts.lock.json"), lock = JSON.parse(readFileSync(lockFile, "utf8"));
  writeFileSync(lockFile, JSON.stringify({...lock, incomplete: true}));
  expect((await run(t.args, t.opts)).stderr).toContain("incomplete");
  writeFileSync(lockFile, JSON.stringify({...lock, pending: ["skill:claude-code:acme/bun-skills"]}));
  expect((await run(t.args, t.opts)).code).toBe(1);
  writeFileSync(lockFile, JSON.stringify(lock));
  await run(["remove", "pipeline"], t.opts);
  expect((await run(t.args, t.opts)).stderr).toContain("loadouts add file:./.loadouts/catalog/pipeline.yml");
  expect(t.events()).toEqual([]);
});

test.each(["WRITE", "READ"])("publication opens a PR from %s access with only the selected file", async permission => {
  const t = await setup(), before = readFileSync(join(t.project, "loadouts.lock.json"), "utf8");
  const seed = join(t.home, "template-seed");
  git(t.project, "clone", t.remote, seed); mkdirSync(join(seed, ".github"));
  writeFileSync(join(seed, ".github/pull_request_template.md"), "## Catalog checklist\n");
  git(seed, "add", "."); git(seed, "commit", "-m", "Add contribution template"); git(seed, "push", "origin", "main");
  const r = await run([...t.args, "--yes"], {...t.opts, env: {...t.opts.env, FAKE_GH_PERMISSION: permission}});
  expect(r.code).toBe(0); expect(r.stdout.trim()).toBe("https://github.com/acme/catalog/pull/42");
  const events = t.events(), pr = events.find(e => e.args[0] === "pr");
  expect(pr.files).toEqual(["loadouts/pipeline.yml"]); expect(pr.body).toContain("Verified with the project's test suite.");
  expect(pr.body).toContain("## Catalog checklist");
  expect(pr.args).toContain("--head"); expect(pr.args).toContain("--base");
  expect(events.some(e => e.args[1] === "fork")).toBe(permission === "READ");
  const head = pr.args[pr.args.indexOf("--head") + 1];
  if (permission === "READ") expect(head).toStartWith("test-user:");
  const pushed = git(permission === "READ" ? t.fork : t.remote, "show", `${head.split(":").at(-1)}:loadouts/pipeline.yml`);
  expect(pushed).toBe(readFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "utf8").trim());
  expect(existsSync(pr.cwd)).toBe(false);
  expect(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).toBe(before);
});

test("publication prepares the PR body before any push and cleans up on preparation failure", async () => {
  const t = await setup(), seed = join(t.home, "invalid-template-seed");
  git(t.project, "clone", t.remote, seed);
  mkdirSync(join(seed, ".github/pull_request_template.md"), {recursive: true});
  writeFileSync(join(seed, ".github/pull_request_template.md/invalid"), "not a template file");
  git(seed, "add", "."); git(seed, "commit", "-m", "Invalid template"); git(seed, "push", "origin", "main");
  const r = await run([...t.args, "--yes"], t.opts);
  expect(r.code).toBe(1);
  expect(git(t.remote, "branch", "--list", "loadouts/*")).toBe("");
  expect(existsSync(t.events().find(e => e.args[1] === "clone").cwd)).toBe(false);
});

test("publication reports clone failure and removes temporary files", async () => {
  const t = await setup();
  const r = await run([...t.args, "--yes"], {...t.opts, env: {...t.opts.env, FAKE_GH_FAIL: "repo clone"}});
  expect(r.code).toBe(1); expect(r.stderr).toContain("simulated GitHub failure");
  expect(git(t.remote, "branch", "--list", "loadouts/*")).toBe("");
  expect(existsSync(t.events().find(e => e.args[1] === "clone").cwd)).toBe(false);
});

test.each(["loadouts/pipeline.yml", "loadouts", ".github/pull_request_template.md", ".github"])("publication rejects catalog symlink at %s before writes or disclosure", async path => {
  const t = await setup(), seed = join(t.home, "symlink-seed"), outside = join(t.home, "private");
  mkdirSync(outside);
  writeFileSync(join(outside, "pipeline.yml"), "private file must stay unchanged");
  writeFileSync(join(outside, "pull_request_template.md"), "private contents must not be published");
  git(t.project, "clone", t.remote, seed);
  if (path.startsWith(".github/")) mkdirSync(join(seed, ".github"));
  rmSync(join(seed, path), {recursive: true, force: true});
  symlinkSync(path.includes("/") ? join(outside, path.split("/").at(-1)!) : outside, join(seed, path));
  git(seed, "add", "."); git(seed, "commit", "-m", "Catalog symlink"); git(seed, "push", "origin", "main");
  const r = await run([...t.args, "--yes"], t.opts);
  expect(readFileSync(join(outside, "pipeline.yml"), "utf8")).toBe("private file must stay unchanged");
  expect(r.code).toBe(1); expect(r.stderr).toContain("symlink");
  expect(t.events().some(e => e.args[0] === "pr" || e.args[1] === "fork")).toBe(false);
  expect(git(t.remote, "branch", "--list", "loadouts/*")).toBe("");
  expect(existsSync(t.events().find(e => e.args[1] === "clone").cwd)).toBe(false);
});

test("publication explains recovery after push succeeds but PR creation fails", async () => {
  const t = await setup();
  const r = await run([...t.args, "--yes"], {...t.opts, env: {...t.opts.env, FAKE_GH_FAIL: "pr create"}});
  expect(r.code).toBe(1); expect(r.stderr).toContain("already pushed"); expect(r.stderr).toContain("gh pr create");
  const pr = t.events().find(e => e.args[0] === "pr");
  expect(existsSync(pr.cwd)).toBe(false);
});

test("publication refuses a no-diff contribution before pushing", async () => {
  const t = await setup();
  const yaml = readFileSync(join(t.project, ".loadouts/catalog/pipeline.yml"), "utf8"), checkout = join(t.home, "seed");
  git(t.project, "clone", t.remote, checkout);
  writeFileSync(join(checkout, "loadouts/pipeline.yml"), yaml); git(checkout, "add", "."); git(checkout, "commit", "-m", "Existing pipeline"); git(checkout, "push", "origin", "main");
  const r = await run([...t.args, "--yes"], t.opts);
  expect(r.code).toBe(1); expect(r.stderr).toContain("already matches");
  expect(t.events().some(e => e.args[0] === "pr")).toBe(false);
  expect(git(t.remote, "branch", "--list", "loadouts/*")).toBe("");
});

test("publication rejects changed manifest sources, harnesses and choices before GitHub calls", async () => {
  const t = await setup(), file = join(t.project, "loadouts.json"), manifest = JSON.parse(readFileSync(file, "utf8"));
  for (const changed of [
    {...manifest, harnesses: []},
    {...manifest, loadouts: {pipeline: {source: "github:acme/catalog/pipeline"}}},
    {...manifest, loadouts: {pipeline: {...manifest.loadouts.pipeline, choices: {runtime: ["other"]}}}},
  ]) {
    writeFileSync(file, JSON.stringify(changed));
    const r = await run([...t.args, "--yes"], t.opts); expect(r.code).toBe(1); expect(r.stderr).toContain("loadouts install");
  }
  expect(t.events()).toEqual([]);
});
