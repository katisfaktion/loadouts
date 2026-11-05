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
  return {...t, opts, args, events, remote, fork};
}

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
