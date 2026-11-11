import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, lstatSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCatalog, repo, run, tempEnv } from "./helpers";

function snapshot(dir: string): unknown {
  return Object.fromEntries(readdirSync(dir).sort().map(name => {
    const path = join(dir, name), stat = lstatSync(path);
    return [name, stat.isSymbolicLink() ? {link: readlinkSync(path)} : stat.isDirectory() ? snapshot(path) : {contents: readFileSync(path).toString("base64"), mtime: stat.mtimeMs}];
  }));
}

async function setup() {
  const t = tempEnv(), catalog = fixtureCatalog(), opts = {cwd: t.project, env: t.env};
  expect((await run(["init", "--harness", "claude-code"], opts)).code).toBe(0);
  expect((await run(["add", "backend", "--catalog", catalog, "--with", "backend/runtime=python"], opts)).code).toBe(0);
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), readFileSync(join(catalog, "loadouts/backend.yml"), "utf8") + "conventions: local replacement\n");
  return {...t, opts, source: `file:${catalog}#backend`, local: "file:./.loadouts/catalog/backend.yml"};
}

async function interactive(args: string[], opts: {cwd: string; env: Record<string, string>}, answer: string) {
  let output = "", prompted = false;
  const child = Bun.spawn([process.execPath, join(repo, "src/cli.ts"), ...args], {
    cwd: opts.cwd, env: {...process.env, ...opts.env, NO_COLOR: "1"},
    terminal: {cols: 200, rows: 30, data(terminal, data) {
      output += new TextDecoder().decode(data);
      if (!prompted && output.includes("[y/N]")) { prompted = true; terminal.write(answer); }
    }},
  });
  const timeout = setTimeout(() => child.kill(), 4000);
  try { return {code: await child.exited, output, prompted}; }
  finally { clearTimeout(timeout); child.terminal!.close(); }
}

test("non-interactive source replacement shows both sources and leaves the project untouched", async () => {
  const t = await setup(), before = snapshot(t.project);
  const result = await run(["add", t.local], t.opts);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(t.source); expect(result.stderr).toContain(t.local);
  expect(result.stderr).toContain("--yes"); expect(snapshot(t.project)).toEqual(before);
});

test.each(["n\n", "\n", "maybe\n", "\x04", "\x03"])("declining or cancelling replacement (%j) makes no changes", async answer => {
  const t = await setup(), before = snapshot(t.project);
  const result = await interactive(["add", t.local], t.opts, answer);
  expect(result.prompted).toBe(true); expect(result.code).toBe(1);
  expect(result.output).toContain(t.source); expect(result.output).toContain(t.local);
  expect(snapshot(t.project)).toEqual(before);
});

test.each(["y\n", "YES\n"])("affirmative confirmation (%j) applies the replacement and retains choices", async answer => {
  const t = await setup(), result = await interactive(["add", t.local], t.opts, answer);
  expect(result.prompted).toBe(true); expect(result.code, result.output).toBe(0);
  const manifest = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8"));
  expect(manifest.loadouts.backend).toEqual({source: t.local, choices: {runtime: ["python"]}});
  expect(JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8")).resolved.backend.source).toBe(t.local);
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).toContain("local replacement");
});

test("--yes authorizes source changes, including catalog overrides and ref changes", async () => {
  const t = await setup(), second = fixtureCatalog();
  for (const [args, source] of [
    [[t.local], t.local],
    [["backend", "--catalog", second], `file:${second}#backend`],
    [[`file:${second}#backend@v1.0.0`], `file:${second}#backend@v1.0.0`],
  ] as [string[], string][]) {
    const before = JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")).loadouts.backend.source;
    const blocked = await run(["add", ...args], t.opts);
    expect(blocked.code).toBe(1); expect(blocked.stderr).toContain(before); expect(blocked.stderr).toContain(source);
    const allowed = await run(["add", ...args, "--yes"], t.opts);
    expect(allowed.code, allowed.stderr).toBe(0); expect(allowed.stderr).toContain(before); expect(allowed.stderr).toContain(source);
    expect(JSON.parse(readFileSync(join(t.project, "loadouts.json"), "utf8")).loadouts.backend.source).toBe(source);
  }
});

test("re-adding the same source or bare name needs no confirmation", async () => {
  const t = await setup(), before = snapshot(t.project);
  for (const name of [t.source, "backend"]) {
    const result = await run(["add", name], t.opts);
    expect(result.code, result.stderr).toBe(0); expect(result.stderr).toBe("");
  }
  expect(snapshot(t.project)).toEqual(before);
});

test("all replacements are shown together and declining cancels new additions too", async () => {
  const t = await setup(), second = fixtureCatalog();
  expect((await run(["add", "base"], t.opts)).code).toBe(0);
  const before = snapshot(t.project);
  const result = await interactive(["add", "frontend", "base", "backend", "--catalog", second], t.opts, "n\n");
  expect(result.code).toBe(1); expect(result.output.match(/\[y\/N\]/g)).toHaveLength(1);
  expect(result.output).toContain(`file:${second}#base`); expect(result.output).toContain(`file:${second}#backend`);
  expect(snapshot(t.project)).toEqual(before);
});

test("agent replaces a local selection with a discovered shared source and restores it twice", async () => {
  const t = tempEnv(), catalog = fixtureCatalog();
  const opts = {cwd: t.project, env: {...t.env, FORCE_COLOR: "1", GIT_ALLOW_PROTOCOL: "file",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${catalog}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/example/catalog.git"}};
  const call = async (...args: string[]) => {
    const r = await run([...args, "--json"], opts);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
    return JSON.parse(r.stdout);
  };
  expect((await run(["setup", "--catalog", "example/catalog", "--harness", "codex"], opts)).code).toBe(0);
  expect((await run(["init"], opts)).code).toBe(0);
  const local = "file:./.loadouts/catalog/backend.yml";
  writeFileSync(join(t.project, ".loadouts/catalog/backend.yml"), "name: backend\nitems: {local: {skills: [acme/local@local]}}\nconventions: Local only.\n");
  const listing = await call("list", "--sources");
  const shared = listing.find((item: any) => item.name === "backend" && item.kind === "catalog").source;
  expect(shared).toBe("github:example/catalog/backend@v1.0.0");
  expect(listing).toContainEqual({name: "backend", kind: "local", source: local});
  expect(await call("list")).toEqual(["backend", "base", "frontend"]);
  expect((await call("show", local)).source.kind).toBe("local");
  expect((await call("show", shared)).source).toMatchObject({repo: "example/catalog", ref: "v1.0.0"});
  expect((await call("add", local)).added).toContain("skill:codex:acme/local@local");
  const before = snapshot(t.project);
  const blocked = await run(["add", shared, "--json"], opts);
  expect(blocked.code).toBe(1); expect(blocked.stdout).toBe("");
  expect(JSON.parse(blocked.stderr).error).toMatchObject({code: "confirmation_required", replacements: [{name: "backend", oldSource: local, newSource: shared}]});
  expect(snapshot(t.project)).toEqual(before);
  const terminal = await interactive(["add", shared, "--json"], opts, "yes\n");
  expect(terminal.prompted).toBe(false); expect(terminal.code).toBe(1);
  expect(JSON.parse(terminal.output)).toEqual(JSON.parse(blocked.stderr));
  expect(snapshot(t.project)).toEqual(before);
  const changes = await call("add", shared, "--yes");
  expect(changes.added).toEqual(["skill:codex:acme/bun-skills"]);
  expect(changes.removed).toEqual(["skill:codex:acme/local@local"]);
  for (const path of ["loadouts.json", "loadouts.lock.json", "skills-lock.json", "AGENTS.md"]) expect(changes.files).toContain(path);
  expect((await call("status")).manifest.loadouts.backend.source).toBe(shared);
  const lock = JSON.parse(readFileSync(join(t.project, "loadouts.lock.json"), "utf8"));
  expect(lock.resolved.backend).toMatchObject({source: shared, catalog: {repo: "example/catalog"}});
  expect(readFileSync(join(t.project, "AGENTS.md"), "utf8")).not.toContain("Local only.");
  const after = snapshot(t.project);
  for (let n = 0; n < 2; n++) {
    expect(await call("install")).toEqual({added: [], removed: [], files: []});
    expect(snapshot(t.project)).toEqual(after);
  }
});

test("JSON distinguishes failed checks, usage errors and missing projects from findings", async () => {
  const t = tempEnv(), opts = {cwd: t.project, env: t.env};
  for (const command of ["status", "doctor", "install"]) {
    const result = await run([command, "--json"], opts);
    expect(result.code).toBe(2); expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({code: "project_not_found", fix: "run loadouts init"});
  }
  const invalid = await run(["add", "--json"], opts);
  expect(invalid.code).toBe(2); expect(JSON.parse(invalid.stderr).error.code).toBe("usage_error");
  await run(["init"], opts);
  const doctor = await run(["doctor", "--json"], opts);
  expect(doctor.code).toBe(1); expect(doctor.stderr).toBe("");
  expect(JSON.parse(doctor.stdout).findings.length).toBeGreaterThan(0);
});
